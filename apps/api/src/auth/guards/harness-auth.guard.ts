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
      const harness = await this.prisma.$queryRawUnsafe<Array<{ harness_id: string }>>(
        `SELECT harness_id FROM harnesses WHERE name = $1`,
        harnessId,
      );
      if (harness.length > 0) {
        resolvedHarnessId = harness[0].harness_id;
      }
    }

    // Check membership
    const membership = await this.prisma.$queryRawUnsafe<Array<{ user_id: string }>>(
      `SELECT user_id FROM harness_members WHERE harness_id = $1::uuid AND user_id = $2::uuid`,
      resolvedHarnessId,
      user.userId,
    );

    if (membership.length === 0) {
      throw new ForbiddenException('You do not have access to this harness');
    }

    // Populate harnessAccess on the user
    user.harnessAccess = [resolvedHarnessId];
    return true;
  }
}
