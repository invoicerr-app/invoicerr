import { PrismaService } from '@/prisma/prisma.service';
import { CallbackRegStatus } from '../../../prisma/generated/prisma/client';
import { CallbackRegistration, CallbackStore, InboundMessage } from '../lifecycle/drivers/inbound-job';
import { ChannelType } from '../types';
import {
  callbackRegToRow,
  callbackRegToUpdateRow,
  rowToCallbackReg,
  inboundMsgToRow,
  rowToInboundMsg,
} from './mappers';

const ACTIVE_STATUSES: CallbackRegStatus[] = ['WAITING'];

export class PrismaCallbackStore implements CallbackStore {
  constructor(private readonly prisma: PrismaService) {}

  async register(reg: CallbackRegistration): Promise<CallbackRegistration> {
    const data = callbackRegToRow(reg);
    await this.prisma.complianceCallbackRegistration.create({ data });
    return reg;
  }

  async save(reg: CallbackRegistration): Promise<CallbackRegistration> {
    await this.prisma.complianceCallbackRegistration.update({
      where: { id: reg.id },
      data: callbackRegToUpdateRow(reg),
    });
    return reg;
  }

  async findByCorrelation(channel: string, correlationKey: string): Promise<CallbackRegistration | null> {
    const row = await this.prisma.complianceCallbackRegistration.findFirst({
      where: { channel, correlationKey, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'asc' },
    });
    return row ? rowToCallbackReg(row) : null;
  }

  async forDocument(documentId: string): Promise<CallbackRegistration[]> {
    const rows = await this.prisma.complianceCallbackRegistration.findMany({
      where: { documentId },
    });
    return rows.map((r) => rowToCallbackReg(r));
  }

  async cancelForDocument(documentId: string): Promise<void> {
    await this.prisma.complianceCallbackRegistration.updateMany({
      where: { documentId, status: { in: ACTIVE_STATUSES } },
      data: { status: 'CANCELLED' },
    });
  }

  async recordMessage(msg: InboundMessage): Promise<{ duplicate: boolean }> {
    if (msg.rawRef) {
      const existing = await this.prisma.complianceInboundMessage.findFirst({
        where: { channel: msg.channel, rawRef: msg.rawRef },
      });
      if (existing) return { duplicate: true };
    }
    const data = inboundMsgToRow(msg);
    await this.prisma.complianceInboundMessage.create({ data });
    return { duplicate: false };
  }

  async waitingRegistrations(): Promise<CallbackRegistration[]> {
    const rows = await this.prisma.complianceCallbackRegistration.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => rowToCallbackReg(r));
  }

  async messagesForCorrelation(channel: ChannelType, correlationKey: string): Promise<InboundMessage[]> {
    const rows = await this.prisma.complianceInboundMessage.findMany({
      where: { channel, correlationKey },
      orderBy: { receivedAt: 'asc' },
    });
    return rows.map((r) => rowToInboundMsg(r));
  }
}
