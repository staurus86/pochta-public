import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import type { Logger } from 'pino';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface FetchedEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  fromEmail: string;
  fromName: string;
  toAddresses: string[];
  ccAddresses: string[];
  date: Date;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: FetchedAttachment[];
  headers: Record<string, string>;
  uid: number;
}

export interface FetchedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  content: Buffer;
  cid: string | null;
}

export class ImapFetcher {
  private connection: Imap | null = null;

  constructor(
    private config: ImapConfig,
    private log: Logger,
  ) {}

  /**
   * Establish IMAP connection.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 30_000,
        authTimeout: 15_000,
      });

      const timeout = setTimeout(() => {
        reject(new Error('IMAP connection timeout'));
        try { imap.end(); } catch { /* ignore */ }
      }, 30_000);

      imap.once('ready', () => {
        clearTimeout(timeout);
        this.connection = imap;
        this.log.info(
          { host: this.config.host, user: this.config.user },
          'IMAP connected',
        );
        resolve();
      });

      imap.once('error', (err: Error) => {
        clearTimeout(timeout);
        this.log.error({ err, host: this.config.host }, 'IMAP connection error');
        reject(err);
      });

      imap.connect();
    });
  }

  /**
   * Fetch new (unseen) emails from specified folders.
   */
  async fetchNewEmails(
    folders: string[] = ['INBOX'],
    maxMessages: number = 50,
  ): Promise<FetchedEmail[]> {
    if (!this.connection) {
      throw new Error('IMAP not connected. Call connect() first.');
    }

    const allEmails: FetchedEmail[] = [];

    for (const folder of folders) {
      try {
        const emails = await this.fetchFromFolder(folder, maxMessages - allEmails.length);
        allEmails.push(...emails);

        if (allEmails.length >= maxMessages) break;
      } catch (err) {
        this.log.error({ err, folder }, 'Failed to fetch from folder');
      }
    }

    this.log.info({ count: allEmails.length, folders }, 'Fetched new emails');
    return allEmails;
  }

  /**
   * Mark specific UIDs as seen in a folder.
   */
  async markAsSeen(folder: string, uids: number[]): Promise<void> {
    if (!this.connection || uids.length === 0) return;

    return new Promise((resolve, reject) => {
      this.connection!.openBox(folder, false, (err) => {
        if (err) return reject(err);

        this.connection!.addFlags(uids, ['\\Seen'], (flagErr) => {
          if (flagErr) {
            this.log.warn({ err: flagErr, folder, uids }, 'Failed to mark as seen');
            return reject(flagErr);
          }
          this.log.debug({ folder, count: uids.length }, 'Marked emails as seen');
          resolve();
        });
      });
    });
  }

  /**
   * Gracefully disconnect from IMAP server.
   */
  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connection) {
        resolve();
        return;
      }

      this.connection.once('end', () => {
        this.log.info('IMAP disconnected');
        this.connection = null;
        resolve();
      });

      try {
        this.connection.end();
      } catch {
        this.connection = null;
        resolve();
      }
    });
  }

  private fetchFromFolder(
    folder: string,
    maxMessages: number,
  ): Promise<FetchedEmail[]> {
    return new Promise((resolve, reject) => {
      if (!this.connection) return reject(new Error('Not connected'));

      this.connection.openBox(folder, true, (err, _box) => {
        if (err) return reject(err);

        this.connection!.search(['UNSEEN'], (searchErr, uids) => {
          if (searchErr) return reject(searchErr);

          if (!uids || uids.length === 0) {
            this.log.debug({ folder }, 'No unseen emails');
            return resolve([]);
          }

          const fetchUids = uids.slice(0, maxMessages);
          const emails: FetchedEmail[] = [];
          const promises: Promise<void>[] = [];

          const fetch = this.connection!.fetch(fetchUids, {
            bodies: '',
            struct: true,
          });

          fetch.on('message', (msg, seqno) => {
            let uid = seqno;

            msg.on('attributes', (attrs) => {
              uid = attrs.uid;
            });

            const p = new Promise<void>((msgResolve) => {
              msg.on('body', (stream) => {
                const chunks: Buffer[] = [];

                stream.on('data', (chunk: Buffer) => {
                  chunks.push(chunk);
                });

                stream.once('end', async () => {
                  try {
                    const raw = Buffer.concat(chunks);
                    const parsed = await simpleParser(raw);
                    const email = this.parsedMailToFetched(parsed, uid);
                    emails.push(email);
                  } catch (parseErr) {
                    this.log.error(
                      { err: parseErr, uid, folder },
                      'Failed to parse email',
                    );
                  }
                  msgResolve();
                });
              });

              msg.once('end', () => {
                // Will resolve via body end handler
              });
            });

            promises.push(p);
          });

          fetch.once('error', (fetchErr: Error) => {
            this.log.error({ err: fetchErr, folder }, 'Fetch error');
            reject(fetchErr);
          });

          fetch.once('end', async () => {
            await Promise.all(promises);
            resolve(emails);
          });
        });
      });
    });
  }

  private parsedMailToFetched(mail: ParsedMail, uid: number): FetchedEmail {
    const from = mail.from?.value?.[0];
    const toAddresses = (mail.to && !Array.isArray(mail.to) ? [mail.to] : (mail.to as typeof mail.from[]) || [])
      .flatMap((addr) => addr?.value?.map((v) => v.address ?? '') ?? [])
      .filter(Boolean);
    const ccAddresses = (mail.cc && !Array.isArray(mail.cc) ? [mail.cc] : (mail.cc as typeof mail.from[]) || [])
      .flatMap((addr) => addr?.value?.map((v) => v.address ?? '') ?? [])
      .filter(Boolean);

    const attachments: FetchedAttachment[] = (mail.attachments ?? []).map((att) => ({
      filename: att.filename ?? 'unnamed',
      mimeType: att.contentType ?? 'application/octet-stream',
      size: att.size ?? 0,
      content: att.content,
      cid: att.cid ?? null,
    }));

    const references = mail.references
      ? (Array.isArray(mail.references) ? mail.references : [mail.references])
      : [];

    const headers: Record<string, string> = {};
    if (mail.headers) {
      for (const [key, value] of mail.headers) {
        headers[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    return {
      messageId: mail.messageId ?? null,
      inReplyTo: (mail.inReplyTo as string) ?? null,
      references,
      subject: mail.subject ?? '(no subject)',
      fromEmail: from?.address ?? '',
      fromName: from?.name ?? '',
      toAddresses,
      ccAddresses,
      date: mail.date ?? new Date(),
      bodyHtml: mail.html || null,
      bodyText: mail.text ?? null,
      attachments,
      headers,
      uid,
    };
  }
}
