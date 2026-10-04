import type {
  CaptchaVerifierPort,
  CaptchaValidationRequest,
  CaptchaValidationResult,
} from "../../ports/captcha.port";

export class HoneypotCaptchaAdapter implements CaptchaVerifierPort {
  constructor(private readonly honeypotFieldName: string = "_hp_val") {}

  getFieldName(): string {
    return this.honeypotFieldName;
  }

  async verify(
    request: CaptchaValidationRequest,
  ): Promise<CaptchaValidationResult> {
    // If the token is empty (honeypot was untouched), valid human request.
    // If the token is populated, automated bot detected.
    const isBot = Boolean(request.token && request.token.trim().length > 0);

    return {
      success: !isBot,
      score: isBot ? 0.0 : 1.0,
      timestamp: new Date().toISOString(),
      errorCodes: isBot ? ["honeypot_trap_triggered"] : undefined,
    };
  }
}
