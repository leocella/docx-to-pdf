// Erro de aplicação padronizado. Mensagem voltada ao usuário, sempre em PT-BR.
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, httpStatus = 400, cause?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
    if (cause) (this as { cause?: unknown }).cause = cause;
  }

  toResponse() {
    return Response.json(
      { code: this.code, message: this.userMessage },
      { status: this.httpStatus },
    );
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if ((err as { name?: string })?.name === "AbortError") {
    return new AppError("TIMEOUT", "O serviço demorou demais para responder. Tente novamente.", 504, err);
  }
  return new AppError("INTERNAL", "Ocorreu um erro inesperado. Tente novamente.", 500, err);
}
