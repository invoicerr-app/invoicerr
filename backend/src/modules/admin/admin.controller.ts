import { Controller, Get, Sse, UseGuards } from "@nestjs/common";
import { from, interval, map, startWith, switchMap } from "rxjs";
import { SuperAdminGuard } from "@/guards/super-admin.guard";
import { PrismaService } from "@/prisma/prisma.service";
import { logger } from "@/logger/logger.service";
import { Prisma } from "../../../prisma/generated/prisma/client";

@Controller("admin")
@UseGuards(SuperAdminGuard)
export class AdminController {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Get all companies (for superadmin dashboard)
	 */
	@Get("companies")
	async getAllCompanies() {
		logger.info("AdminController: Super admin fetching all companies", {
			category: "admin",
		});

		const companies = await this.prisma.company.findMany({
			include: {
				members: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
								firstname: true,
								lastname: true,
							},
						},
					},
				},
				_count: {
					select: {
						clients: true,
						Invoice: true,
						Quote: true,
					},
				},
			},
			orderBy: { foundedAt: "desc" },
		});

		return companies.map((company) => {
			const typedCompany = company as Prisma.CompanyGetPayload<{
				include: {
					members: {
						include: {
							user: {
								select: {
									id: true;
									email: true;
									firstname: true;
									lastname: true;
								};
							};
						};
					};
					_count: {
						select: {
							clients: true;
							Invoice: true;
							Quote: true;
						};
					};
				};
			}>;
			return {
				id: typedCompany.id,
				name: typedCompany.name,
				email: typedCompany.email,
				currency: typedCompany.currency,
				createdAt: typedCompany.foundedAt,
				memberCount: typedCompany.members.length,
				clientCount: typedCompany._count.clients,
				invoiceCount: typedCompany._count.Invoice,
				quoteCount: typedCompany._count.Quote,
				members: typedCompany.members.map((m) => ({
					id: m.user.id,
					email: m.user.email,
					name: `${m.user.firstname} ${m.user.lastname}`,
					role: m.role,
				})),
			};
		});
	}

	/**
	 * Get all users
	 */
	@Get("users")
	async getAllUsers() {
		logger.info("AdminController: Super admin fetching all users", {
			category: "admin",
		});

		const users = await this.prisma.user.findMany({
			include: {
				companies: {
					include: {
						company: {
							select: {
								id: true,
								name: true,
							},
						},
					},
				},
				accounts: true,
				createdInvitations: true,
			},
			orderBy: { createdAt: "desc" },
		});

		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
			select: { id: true },
		});

		return users.map((user) => ({
			id: user.id,
			email: user.email,
			name: `${user.firstname} ${user.lastname}`,
			firstname: user.firstname,
			lastname: user.lastname,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
			isSuperAdmin: user.id === firstUser?.id,
			companyCount: user.companies.length,
			companies: user.companies.map((uc) => ({
				id: uc.company.id,
				name: uc.company.name,
				role: uc.role,
				joinedAt: uc.createdAt,
			})),
		}));
	}

	/**
	 * Get dashboard data with SSE for real-time updates
	 */
	@Sse("dashboard/sse")
	async getDashboardSse() {
		return interval(5000).pipe(
			startWith(0),
			switchMap(() => from(this.getDashboardData())),
			map((data) => ({ data: JSON.stringify(data) })),
		);
	}

	private async getDashboardData() {
		const [totalUsers, totalCompanies, recentCompanies, recentInvoices] =
			await Promise.all([
				this.prisma.user.count(),
				this.prisma.company.count(),
				this.prisma.company.findMany({
					take: 5,
					orderBy: { foundedAt: "desc" },
					select: {
						id: true,
						name: true,
						email: true,
						foundedAt: true,
					},
				}),
				this.prisma.invoice.findMany({
					take: 10,
					orderBy: { createdAt: "desc" },
					include: {
						client: {
							select: { name: true },
						},
						company: {
							select: { name: true },
						},
					},
				}),
			]);

		const recentActivity = recentInvoices.map((inv) => ({
			id: inv.id,
			type: "invoice_created" as const,
			description: `Invoice #${inv.number} for ${inv.client?.name || "Unknown"}`,
			companyName: inv.company?.name || "Unknown",
			timestamp: inv.createdAt.toISOString(),
		}));

		return {
			totalCompanies,
			totalUsers,
			companies: recentCompanies.map((c) => ({
				id: c.id,
				name: c.name,
				createdAt: c.foundedAt?.toISOString() || new Date().toISOString(),
				memberCount: 0,
			})),
			recentActivity,
			stats: {
				companiesGrowth: 0,
				usersGrowth: 0,
			},
		};
	}
}
