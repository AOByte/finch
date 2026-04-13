import { Inject } from '@nestjs/common';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const InjectRedis = (): ParameterDecorator => Inject(REDIS_CLIENT);
