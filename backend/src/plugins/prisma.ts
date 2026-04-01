import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

const prismaPlugin: FastifyPluginAsync = async (app) => {
  const prisma = new PrismaClient({
    log: ["error", "warn"],
  });

  app.decorate("prisma", prisma);
  app.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: "prisma" });
