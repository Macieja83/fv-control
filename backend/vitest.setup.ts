process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://fvresta:fvresta@localhost:5432/fvresta?schema=public";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-min-32-characters-long!!";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-min-32-characters-long!";
process.env.ENCRYPTION_KEY ??= "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
process.env.UPLOAD_DIR ??= "./storage/test-uploads";
