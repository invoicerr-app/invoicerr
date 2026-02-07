import {
	Body,
	Controller,
	Get,
	Post,
	Put,
	Request,
	Sse,
	UseGuards,
} from "@nestjs/common";
import { from, interval, map, startWith, switchMap } from "rxjs";
import { CompanyService } from "@/modules/company/company.service";
import {
	EditCompanyDto,
	PDFConfigDto,
	CreateCompanyDto,
} from "@/modules/company/dto/company.dto";
import { TenantGuard } from "@/guards/tenant.guard";
import { PermissionGuard, RequiredRoles } from "@/guards/permission.guard";
import { Company } from "@/decorators/company.decorator";
import { User } from "@/decorators/user.decorator";
import { CompanyMembershipService } from "@/modules/company-membership/company-membership.service";
import { UserRole } from "../../../prisma/generated/prisma/client";
import { AuthGuard } from "@/guards/auth.guard";

@Controller("company")
@UseGuards(AuthGuard, TenantGuard)
export class CompanyController {
	constructor(
		private readonly companyService: CompanyService,
		private readonly companyMembershipService: CompanyMembershipService,
	) {}

	/**
	 * Create a new company for the current user
	 */
	@Post()
	async createCompany(
		@User() user: any,
		@Body() body: CreateCompanyDto,
	) {
		const company = await this.companyService.createCompany(body, user.id);
		return {
			id: company.id,
			name: company.name,
			currency: company.currency,
		};
	}

	@Get("info")
	async getCompanyInfo(@Company() companyId: string | null) {
		const data = await this.companyService.getCompanyInfo(companyId);
		return data || {};
	}

	@Sse("info/sse")
	async getCompanyInfoSse(
		@Company() companyId: string | null,
		@Request() req: any,
	) {
		// Allow companyId from query param for SSE connections
		const queryCompanyId = req.query?.companyId || companyId;
		
		return interval(1000).pipe(
			startWith(0),
			switchMap(() => from(this.companyService.getCompanyInfo(queryCompanyId))),
			map((company) => ({ data: JSON.stringify(company) })),
		);
	}

	@Post("info")
	async postCompanyInfo(
		@Company() companyId: string | null,
		@Body() body: EditCompanyDto,
	) {
		const data = await this.companyService.editCompanyInfo(companyId, body);
		return data || {};
	}

	@Get("pdf-template")
	async getPDFTemplateConfig(@Company() companyId: string | null) {
		const data = await this.companyService.getPDFTemplateConfig(companyId);
		return data || {};
	}

	@Post("pdf-template")
	async postPDFTemplateConfig(
		@Company() companyId: string | null,
		@Body() body: PDFConfigDto,
	) {
		const data = await this.companyService.editPDFTemplateConfig(companyId, body);
		return data || {};
	}

	@Get("email-templates")
	async getEmailTemplates(@Company() companyId: string | null) {
		const data = await this.companyService.getEmailTemplates(companyId);
		return data || {};
	}

	@Put("email-templates")
	async updateEmailTemplate(
		@Company() companyId: string | null,
		@Body() body: { dbId: string; subject: string; body: string },
	) {
		const data = await this.companyService.updateEmailTemplate(
			companyId,
			body.dbId,
			body.subject,
			body.body,
		);
		return data || {};
	}

	/**
	 * Switch active company for the current user
	 */
	@Post("switch")
	async switchCompany(
		@User() user: any,
		@Body() body: { companyId: string },
	) {
		const membership = await this.companyMembershipService.switchCompany(
			user.id,
			body.companyId,
		);

		return {
			companyId: membership.companyId,
			companyName: membership.company.name,
			role: membership.role,
		};
	}

	/**
	 * Get current user's companies with roles
	 */
	@Get("my-companies")
	async getUserCompanies(@User() user: any) {
		const companies = await this.companyMembershipService.getUserCompanies(
			user.id,
		);

		return companies.map((uc) => ({
			companyId: uc.companyId,
			company: {
				id: uc.company.id,
				name: uc.company.name,
				email: uc.company.email,
				currency: uc.company.currency,
			},
			role: uc.role,
			joinedAt: uc.createdAt,
		}));
	}

	/**
	 * Get members of the current company
	 */
	@Get("members")
	@UseGuards(PermissionGuard)
	@RequiredRoles(UserRole.ADMIN)
	async getCompanyMembers(@User() user: any) {
		// Get current company from request context (set by TenantGuard)
		// Note: In actual implementation, you'd get this from TenantContext
		const userCompanies = await this.companyMembershipService.getUserCompanies(
			user.id,
		);

		if (userCompanies.length === 0) {
			return { members: [] };
		}

		// For now, return members of the first company the user has access to
		// In production, you'd use the current company from request context
		const currentCompany = userCompanies[0];
		const members = await this.companyMembershipService.getCompanyMembers(
			currentCompany.companyId,
		);

		return { members };
	}
}
