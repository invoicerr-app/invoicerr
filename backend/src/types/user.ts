import { User, UserRole } from "../../prisma/generated/prisma/client";

export interface UserCompanyInfo {
	companyId: string;
	role: UserRole;
}

export interface CurrentUser extends Omit<User, "password"> {
	id: string;
	firstname: string;
	lastname: string;
	email: string;
	accessToken?: string;
	// Multi-tenant fields
	currentCompanyId?: string | null;
	userCompanies?: UserCompanyInfo[];
	role?: UserRole;
	isSuperAdmin?: boolean;
}
