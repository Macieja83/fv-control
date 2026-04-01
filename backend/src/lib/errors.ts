export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BOOTSTRAP_CLOSED"
  | "INTERNAL";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(message: string, statusCode: number, code: ErrorCode, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(message, 400, "VALIDATION_ERROR", details);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message = "Forbidden"): AppError {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static notFound(message = "Not found"): AppError {
    return new AppError(message, 404, "NOT_FOUND");
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, "CONFLICT");
  }

  static bootstrapClosed(): AppError {
    return new AppError("Registration is closed", 403, "BOOTSTRAP_CLOSED");
  }

  static internal(message = "Internal server error"): AppError {
    return new AppError(message, 500, "INTERNAL");
  }
}
