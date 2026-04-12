import { Injectable, CanActivate, ExecutionContext, BadRequestException } from '@nestjs/common';

const GATE_CONDITION_PATTERNS = [
  /fire[_\s]?gate/i,
  /clarification[_\s]?gate/i,
  /context[_\s]?gap/i,
  /gate[_\s]?condition/i,
];

@Injectable()
export class LockedPreambleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ body?: { systemPromptBody?: string } }>();
    const body = request.body;
    if (!body?.systemPromptBody) return true;

    const text = body.systemPromptBody;
    for (const pattern of GATE_CONDITION_PATTERNS) {
      if (pattern.test(text)) {
        throw new BadRequestException(
          'systemPromptBody must not contain gate condition language. Gate conditions are framework-owned and injected server-side (FC-09).',
        );
      }
    }
    return true;
  }
}
