import {
  type LegalDocumentResponse,
  LegalDocumentType,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { parseParam } from "../lib/validate.ts";
import { legalService } from "../services/legal.ts";
import type { AppEnv, Deps } from "../types.ts";

/** Public legal texts for the website (eRecht24, cached in memory, sanitised; P-025). */
export function legalRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const service = legalService(deps);

  app.get("/:type", async (c) => {
    const type = parseParam(c, "type", LegalDocumentType);
    const body: LegalDocumentResponse = await service.getDocument(type);
    return c.json(body);
  });

  return app;
}
