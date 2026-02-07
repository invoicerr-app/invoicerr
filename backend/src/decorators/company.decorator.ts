import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export const Company = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): string | null => {
		const request = ctx.switchToHttp().getRequest();
		return request.headers["x-company-id"] || null;
	},
);
