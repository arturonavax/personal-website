import type {
  CaptchaVerifierPort,
  CaptchaValidationRequest,
  CaptchaValidationResult,
} from "../../ports/captcha.port";

export class TurnstileCaptchaAdapter implements CaptchaVerifierPort {
  constructor(private readonly secretKey: string) {}

  async verify(
    request: CaptchaValidationRequest,
  ): Promise<CaptchaValidationResult> {
    try {
      const formData = new URLSearchParams();
      formData.append("secret", this.secretKey);
      formData.append("response", request.token);
      if (request.remoteIp) {
        formData.append("remoteip", request.remoteIp);
      }

      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: formData,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      if (!res.ok) {
        return {
          success: false,
          errorCodes: [`http_status_${res.status}`],
        };
      }

      const outcome = (await res.json()) as {
        success: boolean;
        "error-codes"?: string[];
        challenge_ts?: string;
        hostname?: string;
      };

      return {
        success: outcome.success,
        errorCodes: outcome["error-codes"],
        timestamp: outcome.challenge_ts,
        hostname: outcome.hostname,
      };
    } catch (err) {
      return {
        success: false,
        errorCodes: [err instanceof Error ? err.message : "unknown_error"],
      };
    }
  }
}
