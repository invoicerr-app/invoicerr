import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { RequestWithUser } from "@/types/request";
import { CurrentUser } from "@/types/user";

export const User = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): CurrentUser => {
		const request = ctx.switchToHttp().getRequest() as RequestWithUser;
		return request.user;
	},
);
