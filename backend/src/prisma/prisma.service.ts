import 'dotenv/config'

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../prisma/generated/prisma/client';

import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

const prisma = new PrismaClient({ adapter });

export default prisma;

// Injectable PrismaService for NestJS dependency injection
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
    private readonly client = prisma;

    async onModuleInit() {
        // Connection is handled by the client automatically
    }

    async onModuleDestroy() {
        await this.client.$disconnect();
    }

    // Expose all Prisma models
    get user() { return this.client.user; }
    get session() { return this.client.session; }
    get account() { return this.client.account; }
    get verification() { return this.client.verification; }
    get invitationCode() { return this.client.invitationCode; }
    get company() { return this.client.company; }
    get client_model() { return this.client.client; }
    get quote() { return this.client.quote; }
    get invoice() { return this.client.invoice; }
    get payment() { return this.client.payment; }
    get paymentItem() { return this.client.paymentItem; }
    get recurringInvoice() { return this.client.recurringInvoice; }
    get paymentMethod() { return this.client.paymentMethod; }
    get webhook() { return this.client.webhook; }
    get plugin() { return this.client.plugin; }

    // Compliance lifecycle (TODO_PRISMA.md §4)
    get complianceDocument() { return this.client.complianceDocument; }
    get complianceEvent() { return this.client.complianceEvent; }
    get complianceAuthorityId() { return this.client.complianceAuthorityId; }
    get scheduledJob() { return this.client.scheduledJob; }
    get complianceCallbackRegistration() { return this.client.complianceCallbackRegistration; }
    get complianceInboundMessage() { return this.client.complianceInboundMessage; }

    get numberSeries() { return this.client.numberSeries; }

    /** Run an interactive transaction; `tx` exposes the same per-model delegates. */
    transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return (this.client as any).$transaction(fn) as Promise<T>;
    }
}
