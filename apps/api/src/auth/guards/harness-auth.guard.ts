import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma.service';
import { Request } from 'express';

interface AuthUser {
  userId: string;
  email: string;
  harnessAccess?: string[];
}

@Injectable()
export class HarnessAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    // Extract harnessId from params, body, or query (in that order)
    const harnessId =
      (request.params?.harnessId as string) ??
      (request.body?.harnessId as string) ??
      (request.query?.harnessId as string);

    if (!harnessId) {
      // No harnessId in the request — nothing to guard
      return true;
    }

    // Resolve harness name to ID if needed (e.g., "default")
    let resolvedHarnessId = harnessId;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(harnessId)) {
      const harness = await this.prisma.harness.findFirst({ where: { name: harnessId } });
      if (harness) {
        resolvedHarnessId = harness.harnessId;
      }
    }

    // Check membership
    const membership = await this.prisma.harnessMember.findUnique({
      where: {
        userId_harnessId: {
          userId: user.userId,
          harnessId: resolvedHarnessId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this harness');
    }

    // Populate harnessAccess on the user
    user.harnessAccess = [resolvedHarnessId];
    return true;
  }
}
