import { z } from "zod";

export const ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional()
});

export const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(ErrorDetailSchema).default([]),
  correlation_id: z.string().optional()
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details: ErrorDetail[] = []
  ) {
    super(message);
    this.name = "AppError";
  }

  toEnvelope(correlationId?: string): ErrorEnvelope {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      correlation_id: correlationId
    };
  }
}
