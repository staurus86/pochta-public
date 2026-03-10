import { getCurrentScheduleSlot, isScheduleDue } from "./project-schedule.js";
import { runTenderImporter } from "./tender-runner.js";
import { runMailboxFileParser } from "./project3-runner.js";

export class ProjectScheduler {
  constructor({ store, rootDir, logger = console }) {
    this.store = store;
    this.rootDir = rootDir;
    this.logger = logger;
    this.timer = null;
    this.inFlightProjectIds = new Set();
  }

  start() {
    if (this.timer) {
      return;
    }

    this.tick().catch((error) => {
      this.logger.error("Scheduler bootstrap failed:", error);
    });

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error("Scheduler tick failed:", error);
      });
    }, 60 * 60 * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now = new Date()) {
    const projects = await this.store.listProjects();
    for (const project of projects) {
      if (!project.schedule || !isScheduleDue(project.schedule, now)) {
        continue;
      }

      if (this.inFlightProjectIds.has(project.id)) {
        continue;
      }

      this.inFlightProjectIds.add(project.id);
      const slot = getCurrentScheduleSlot(project.schedule, now);

      try {
        await this.store.markScheduleTriggered(project.id, slot, now.toISOString());
        await this.executeProject(project);
      } catch (error) {
        this.logger.error(`Scheduled run failed for ${project.id}:`, error);
        await this.store.appendRun(project.id, {
          id: `${project.id}-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: "error",
          days: Number(project.schedule?.days || 1),
          processed: 0,
          added: 0,
          skipped: 0,
          failed: 1,
          durationMs: 0,
          trigger: "schedule",
          message: error.message
        });
      } finally {
        this.inFlightProjectIds.delete(project.id);
      }
    }
  }

  async executeProject(project) {
    if (project.type === "tender-importer") {
      const run = await runTenderImporter(project, this.rootDir, {
        days: Number(project.schedule?.days || 1)
      });

      run.trigger = "schedule";
      await this.store.appendRun(project.id, run);
      return;
    }

    if (project.type === "mailbox-file-parser") {
      const run = await runMailboxFileParser(project, this.rootDir, {
        days: Number(project.schedule?.days || 1)
      });

      run.trigger = "schedule";
      await this.store.appendRun(project.id, run);
      return;
    }

    throw new Error(`Scheduled action is not implemented for project type '${project.type}'.`);
  }
}
