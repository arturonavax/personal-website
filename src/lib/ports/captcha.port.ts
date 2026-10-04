export interface CaptchaValidationRequest {
  token: string;
  remoteIp?: string | undefined;
}

export interface CaptchaValidationResult {
  success: boolean;
  score?: number | undefined;
  timestamp?: string | undefined;
  hostname?: string | undefined;
  errorCodes?: string[] | undefined;
}

export interface CaptchaVerifierPort {
  verify(request: CaptchaValidationRequest): Promise<CaptchaValidationResult>;
}
