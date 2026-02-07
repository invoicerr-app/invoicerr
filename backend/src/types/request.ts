import { Request } from "express";
import { CurrentUser } from "@/types/user";

interface RequestWithUser extends Request {
	user: CurrentUser;
}

export type { RequestWithUser };
