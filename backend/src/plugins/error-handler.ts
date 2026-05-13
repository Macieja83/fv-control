import fp from "fastify-plugin";
import type { FastifyError, FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { formatUserFacingZodMessage } from "../lib/validate.js";

function isFastifyValidationError(err: unknown): err is FastifyError {
  return typeof err === "object" && err !== null && "validation" in err;
}

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, request, reply) => {
    const reqId = request.requestId;

    if (err instanceof AppError) {
      request.log.warn({ err: { message: err.message, code: err.code }, reqId }, "app error");
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
          requestId: reqId,
        },
      });
    }

    if (err instanceof ZodError) {
      request.log.warn({ err: err.flatten(), reqId }, "zod error");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: formatUserFacingZodMessage(err),
          details: err.flatten(),
          requestId: reqId,
        },
      });
    }

    if (isFastifyValidationError(err) && err.validation) {
      request.log.warn({ err: err.message, reqId }, "request validation");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.message,
          details: err.validation,
          requestId: reqId,
        },
      });
    }

    request.log.error({ err, reqId }, "unhandled error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL",
        message: "Internal server error",
        details: null,
        requestId: reqId,
      },
    });
  });
};

export default fp(errorHandlerPlugin, { name: "error-handler" });
