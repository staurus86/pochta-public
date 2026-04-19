// email-zoning.js — splits email body into semantic zones before article extraction.
// Priority for article confidence: subject > currentMessage > attachmentText > signature > quotedThread.

export const ZONES = Object.freeze({
    SUBJECT: "subject",
    CURRENT: "current",
    SIGNATURE: "signature",
    QUOTED: "quoted",
    ATTACHMENT: "attachment",
});

// Marker regexes that indicate start of quoted/forwarded thread
const QUOTED_THREAD_MARKERS = [
    /^\s*-{2,}\s*Original\s*Message\s*-{2,}/im,
    /^\s*-{2,}\s*Переслан(?:ное|ая)\s*сообщение/im,
    /^\s*From:\s+.+\n.*Sent:/im,
    /^\s*От:\s+.+\n.*Отправлено:/im,
    /^\s*На\s+\d+\.\d+\.\d{4}.*написал/im,
    /^\s*On\s+.+wrote:/im,
];

// Signature markers
const SIGNATURE_MARKERS = [
    /^\s*--\s*$/m,
    /^\s*(?:С уважением|Best regards|Kind regards|Regards|Sincerely|BR|Mit freundlichen Grüßen)/im,
];

function findFirstMatch(text, regexes) {
    let earliest = -1;
    for (const re of regexes) {
        const m = text.match(re);
        if (m && m.index !== undefined) {
            if (earliest === -1 || m.index < earliest) earliest = m.index;
        }
    }
    return earliest;
}

// Split the email body into currentMessage / signature / quotedThread.
// attachmentText passed through as-is from attachments analysis.
export function splitZones(email = {}) {
    const subject = String(email.subject || "");
    const body = String(email.body || "");
    const attachmentText = String(email.attachmentText || "");

    let current = body;
    let signature = "";
    let quotedThread = "";

    // 1. Quoted/forwarded thread split
    const quotedIdx = findFirstMatch(body, QUOTED_THREAD_MARKERS);
    if (quotedIdx !== -1) {
        current = body.slice(0, quotedIdx);
        quotedThread = body.slice(quotedIdx);
    }

    // 2. Signature split within current message
    const sigIdx = findFirstMatch(current, SIGNATURE_MARKERS);
    if (sigIdx !== -1) {
        signature = current.slice(sigIdx);
        current = current.slice(0, sigIdx);
    }

    return {
        subject,
        currentMessage: current.trim(),
        signature: signature.trim(),
        quotedThread: quotedThread.trim(),
        attachmentText: attachmentText.trim(),
    };
}

// Zone priority for scoring: higher index = more trusted for articles
// (subject strongest because it's explicit request)
export const ZONE_PRIORITY = {
    [ZONES.SUBJECT]: 4,
    [ZONES.CURRENT]: 3,
    [ZONES.ATTACHMENT]: 2,
    [ZONES.SIGNATURE]: 1,
    [ZONES.QUOTED]: 1,
};
