import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

// Gate condition patterns that must never appear in user-editable prompt body
const GATE_PATTERNS = [
  /\bfire[_\s]*gate\b/i,
  /\bgate\.fire\b/i,
  /\bemit[_\s]*gate\b/i,
  /\btrigger[_\s]*gate\b/i,
  /\braise[_\s]*gate\b/i,
];

@Injectable()
export class LockedPreambleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as { systemPromptBody?: string } | undefined;

    if (!body?.systemPromptBody) {
      return true;
    }

    const promptBody = body.systemPromptBody;

    for (const pattern of GATE_PATTERNS) {
      if (pattern.test(promptBody)) {
        throw new BadRequestException(
          `System prompt body contains a gate condition pattern ("${pattern.source}"). ` +
          'Gate conditions are framework-owned and must not appear in user-editable prompts (FF-08).',
        );
      }
    }

    return true;
  }
}
