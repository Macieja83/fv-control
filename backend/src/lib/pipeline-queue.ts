import { Queue } from "bullmq";
import { loadConfig } from "../config.js";
import { getRedisConnection } from "./redis-connection.js";
import { PIPELINE_QUEUE_NAME } from "./queue-constants.js";

let pipelineQueue: Queue | null = null;

export function getPipelineQueue(): Queue {
  if (!pipelineQueue) {
    const cfg = loadConfig();
    pipelineQueue = new Queue(PIPELINE_QUEUE_NAME, {
      connection: getRedisConnection(),
      prefix: cfg.BULLMQ_PREFIX,
    });
  }
  return pipelineQueue;
}
