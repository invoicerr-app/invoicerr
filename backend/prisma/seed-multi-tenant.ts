import { PrismaClient, UserRole, Currency } from '../generated/prisma';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Multi-Tenant Test Seed Script
 * 
 * This script creates test data for multi-tenant testing:
 * - 3 Companies with different settings
 * - 5 Users with different roles across companies
 * - Test clients and invoices for data isolation testing
 * - Invitation codes for testing invitation flow
 */

async function main() {
  console.log('🌱 Starting multi-tenant test seed...\n');

  // Clean up existing test data
  console.log('Cleaning up existing test data...');
  await prisma.receiptItem.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.invoiceItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.quoteItem.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.webhook.deleteMany({});
  await prisma.paymentMethod.deleteMany({});
  await prisma.mailTemplate.deleteMany({});
  await prisma.invitation_code.deleteMany({});
  await prisma.user_company.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: '@test.com',
      },
    },
  });
  await prisma.company.deleteMany({
    where: {
      email: {
        contains: '@test.com',
      },
    },
  });
  await prisma.pDFConfig.deleteMany({});
  console.log('✓ Cleanup complete\n');

  // Create PDF configs
  console.log('Creating PDF configurations...');
  const pdfConfigs = await Promise.all([
    prisma.pDFConfig.create({
      data: {
        fontFamily: 'Arial',
        padding: 40,
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        invoice: 'Invoice',
        quote: 'Quote',
      },
    }),
    prisma.pDFConfig.create({
      data: {
        fontFamily: 'Helvetica',
        padding: 50,
        primaryColor: '#10b981',
        secondaryColor: '#6b7280',
        invoice: 'Facture',
        quote: 'Devis',
      },
    }),
    prisma.pDFConfig.create({
      data: {
        fontFamily: 'Times New Roman',
        padding: 35,
        primaryColor: '#8b5cf6',
        secondaryColor: '#9ca3af',
        invoice: 'Rechnung',
        quote: 'Angebot',
      },
    }),
  ]);
  console.log(`✓ Created ${pdfConfigs.length} PDF configs\n`);

  // Create companies
  console.log('Creating test companies...');
  const companies = await Promise.all([
    prisma.company.create({
      data: {
        name: 'Acme Corporation',
        description: 'Global technology solutions provider',
        currency: Currency.USD,
        legalId: 'US123456789',
        foundedAt: new Date('2010-01-15'),
        VAT: 'US123456789VAT',
        address: '123 Innovation Drive',
        addressLine2: 'Suite 500',
        postalCode: '90210',
        city: 'Los Angeles',
        state: 'California',
        country: 'USA',
        phone: '+1-555-0123',
        email: 'acme@test.com',
        quoteStartingNumber: 100,
        quoteNumberFormat: 'Q-{year}-{number:4}',
        invoiceStartingNumber: 1000,
        invoiceNumberFormat: 'INV-{year}-{number:4}',
        receiptStartingNumber: 500,
        receiptNumberFormat: 'REC-{year}-{number:4}',
        invoicePDFFormat: 'pdf',
        dateFormat: 'MM/dd/yyyy',
        pDFConfigId: pdfConfigs[0].id,
      },
    }),
    prisma.company.create({
      data: {
        name: 'TechStart France',
        description: 'Innovation digitale pour startups',
        currency: Currency.EUR,
        legalId: 'FR987654321',
        foundedAt: new Date('2018-03-22'),
        VAT: 'FR98765432101',
        address: '25 Avenue des Champs-Élysées',
        postalCode: '75008',
        city: 'Paris',
        country: 'France',
        phone: '+33-1-23-45-67-89',
        email: 'techstart@test.com',
        quoteStartingNumber: 1,
        quoteNumberFormat: 'D-{year}-{number:4}',
        invoiceStartingNumber: 1,
        invoiceNumberFormat: 'F-{year}-{number:4}',
        receiptStartingNumber: 1,
        receiptNumberFormat: 'R-{year}-{number:4}',
        invoicePDFFormat: 'facturx',
        dateFormat: 'dd/MM/yyyy',
        pDFConfigId: pdfConfigs[1].id,
      },
    }),
    prisma.company.create({
      data: {
        name: 'Müller GmbH',
        description: 'Deutsche Engineering Excellence',
        currency: Currency.EUR,
        legalId: 'DE456789123',
        foundedAt: new Date('2005-07-10'),
        VAT: 'DE456789123',
        address: 'Industriestraße 42',
        postalCode: '10115',
        city: 'Berlin',
        country: 'Germany',
        phone: '+49-30-12345678',
        email: 'muller@test.com',
        quoteStartingNumber: 500,
        quoteNumberFormat: 'ANG-{year}-{number:4}',
        invoiceStartingNumber: 2000,
        invoiceNumberFormat: 'RE-{year}-{number:4}',
        receiptStartingNumber: 1000,
        receiptNumberFormat: 'QRE-{year}-{number:4}',
        invoicePDFFormat: 'zugferd',
        dateFormat: 'dd.MM.yyyy',
        pDFConfigId: pdfConfigs[2].id,
      },
    }),
  ]);
  console.log(`✓ Created ${companies.length} companies\n`);

  // Create users
  console.log('Creating test users...');
  const users = await Promise.all([
    // SuperAdmin - has access to all companies
    prisma.user.create({
      data: {
        id: 'superadmin-test-id',
        email: 'superadmin@test.com',
        firstname: 'Alexander',
        lastname: 'SuperAdmin',
        emailVerified: true,
        createdAt: new Date('2020-01-01'),
      },
    }),
    // Admin of Acme Corporation
    prisma.user.create({
      data: {
        id: 'admin-acme-id',
        email: 'admin.acme@test.com',
        firstname: 'John',
        lastname: 'Admin',
        emailVerified: true,
        createdAt: new Date('2020-06-15'),
      },
    }),
    // Admin of TechStart France
    prisma.user.create({
      data: {
        id: 'admin-techstart-id',
        email: 'admin.techstart@test.com',
        firstname: 'Marie',
        lastname: 'Lefèvre',
        emailVerified: true,
        createdAt: new Date('2021-02-10'),
      },
    }),
    // Regular user at Acme
    prisma.user.create({
      data: {
        id: 'user-acme-id',
        email: 'user.acme@test.com',
        firstname: 'Bob',
        lastname: 'User',
        emailVerified: true,
        createdAt: new Date('2022-03-20'),
      },
    }),
    // User with access to multiple companies
    prisma.user.create({
      data: {
        id: 'multi-company-id',
        email: 'multi@test.com',
        firstname: 'Sarah',
        lastname: 'MultiCompany',
        emailVerified: true,
        createdAt: new Date('2021-08-05'),
      },
    }),
  ]);
  console.log(`✓ Created ${users.length} users\n`);

  // Assign roles through UserCompany junction table
  console.log('Assigning user roles to companies...');
  await Promise.all([
    // SuperAdmin has SUPERADMIN role in all companies
    prisma.user_company.create({
      data: {
        userId: users[0].id,
        companyId: companies[0].id,
        role: UserRole.SUPERADMIN,
      },
    }),
    prisma.user_company.create({
      data: {
        userId: users[0].id,
        companyId: companies[1].id,
        role: UserRole.SUPERADMIN,
      },
    }),
    prisma.user_company.create({
      data: {
        userId: users[0].id,
        companyId: companies[2].id,
        role: UserRole.SUPERADMIN,
      },
    }),
    // Admin of Acme
    prisma.user_company.create({
      data: {
        userId: users[1].id,
        companyId: companies[0].id,
        role: UserRole.ADMIN,
      },
    }),
    // Admin of TechStart
    prisma.user_company.create({
      data: {
        userId: users[2].id,
        companyId: companies[1].id,
        role: UserRole.ADMIN,
      },
    }),
    // Regular user at Acme
    prisma.user_company.create({
      data: {
        userId: users[3].id,
        companyId: companies[0].id,
        role: UserRole.USER,
      },
    }),
    // Multi-company user: ADMIN at Acme, USER at TechStart
    prisma.user_company.create({
      data: {
        userId: users[4].id,
        companyId: companies[0].id,
        role: UserRole.ADMIN,
      },
    }),
    prisma.user_company.create({
      data: {
        userId: users[4].id,
        companyId: companies[1].id,
        role: UserRole.USER,
      },
    }),
  ]);
  console.log('✓ User roles assigned\n');

  // Create clients for each company
  console.log('Creating test clients...');
  const clients = await Promise.all([
    // Acme Corporation clients
    prisma.client.create({
      data: {
        name: 'Global Tech Solutions',
        description: 'Enterprise software client',
        legalId: 'US987654321',
        VAT: 'US987654321VAT',
        foundedAt: new Date('2015-05-20'),
        contactFirstname: 'Michael',
        contactLastname: 'Johnson',
        contactEmail: 'michael@gts.com',
        contactPhone: '+1-555-9876',
        address: '456 Enterprise Blvd',
        postalCode: '10001',
        city: 'New York',
        state: 'New York',
        country: 'USA',
        currency: Currency.USD,
        type: 'COMPANY',
        salutation: 'Mr',
        sex: 'male',
        title: 'Doctor',
      },
    }),
    prisma.client.create({
      data: {
        name: 'StartupXYZ',
        description: 'Fast-growing startup',
        legalId: 'US111222333',
        contactFirstname: 'Emily',
        contactLastname: 'Chen',
        contactEmail: 'emily@startupxyz.com',
        contactPhone: '+1-555-4444',
        address: '789 Innovation Way',
        postalCode: '94105',
        city: 'San Francisco',
        state: 'California',
        country: 'USA',
        currency: Currency.USD,
        type: 'COMPANY',
        salutation: 'Ms',
        sex: 'female',
        title: 'Professor',
      },
    }),
    // TechStart France clients
    prisma.client.create({
      data: {
        name: 'SARL Dupont',
        description: 'Client français traditionnel',
        legalId: 'FR123456789',
        VAT: 'FR12345678901',
        foundedAt: new Date('2000-01-01'),
        contactFirstname: 'Pierre',
        contactLastname: 'Dupont',
        contactEmail: 'pierre@dupont.fr',
        contactPhone: '+33-1-98-76-54-32',
        address: '12 Rue de la Paix',
        postalCode: '75002',
        city: 'Paris',
        country: 'France',
        currency: Currency.EUR,
        type: 'COMPANY',
        salutation: 'Mr',
        sex: 'male',
      },
    }),
    prisma.client.create({
      data: {
        name: 'Marie Martin',
        description: 'Consultante indépendante',
        legalId: 'FR789123456',
        contactFirstname: 'Marie',
        contactLastname: 'Martin',
        contactEmail: 'marie@martin-consulting.fr',
        contactPhone: '+33-6-12-34-56-78',
        address: '5 Avenue Victor Hugo',
        postalCode: '75016',
        city: 'Paris',
        country: 'France',
        currency: Currency.EUR,
        type: 'INDIVIDUAL',
        salutation: 'Ms',
        sex: 'female',
      },
    }),
    // Müller GmbH clients
    prisma.client.create({
      data: {
        name: 'Schmidt AG',
        description: 'Deutscher Industriekunde',
        legalId: 'DE987654321',
        VAT: 'DE987654321',
        foundedAt: new Date('1990-03-15'),
        contactFirstname: 'Hans',
        contactLastname: 'Schmidt',
        contactEmail: 'hans@schmidt-ag.de',
        contactPhone: '+49-30-98765432',
        address: 'Friedrichstraße 100',
        postalCode: '10117',
        city: 'Berlin',
        country: 'Germany',
        currency: Currency.EUR,
        type: 'COMPANY',
        salutation: 'Mr',
        sex: 'male',
      },
    }),
  ]);
  console.log(`✓ Created ${clients.length} clients\n`);

  // Create invoices for data isolation testing
  console.log('Creating test invoices...');
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await Promise.all([
    // Acme invoices
    prisma.invoice.create({
      data: {
        number: 1000,
        rawNumber: 'INV-2026-1000',
        clientId: clients[0].id,
        companyId: companies[0].id,
        status: 'PAID',
        createdAt: new Date('2026-01-15'),
        dueDate: thirtyDaysFromNow,
        paidAt: new Date('2026-01-20'),
        totalHT: 5000,
        totalVAT: 1000,
        totalTTC: 6000,
        currency: Currency.USD,
        notes: 'Enterprise consulting services',
      },
    }),
    prisma.invoice.create({
      data: {
        number: 1001,
        rawNumber: 'INV-2026-1001',
        clientId: clients[1].id,
        companyId: companies[0].id,
        status: 'UNPAID',
        createdAt: new Date('2026-02-01'),
        dueDate: thirtyDaysFromNow,
        totalHT: 2500,
        totalVAT: 500,
        totalTTC: 3000,
        currency: Currency.USD,
        notes: 'Startup development package',
      },
    }),
    // TechStart invoices
    prisma.invoice.create({
      data: {
        number: 1,
        rawNumber: 'F-2026-0001',
        clientId: clients[2].id,
        companyId: companies[1].id,
        status: 'SENT',
        createdAt: new Date('2026-01-20'),
        dueDate: thirtyDaysFromNow,
        totalHT: 8000,
        totalVAT: 1600,
        totalTTC: 9600,
        currency: Currency.EUR,
        notes: 'Développement application mobile',
      },
    }),
    prisma.invoice.create({
      data: {
        number: 2,
        rawNumber: 'F-2026-0002',
        clientId: clients[3].id,
        companyId: companies[1].id,
        status: 'OVERDUE',
        createdAt: new Date('2025-12-01'),
        dueDate: new Date('2025-12-31'),
        totalHT: 3000,
        totalVAT: 600,
        totalTTC: 3600,
        currency: Currency.EUR,
        notes: 'Consulting services',
      },
    }),
    // Müller invoices
    prisma.invoice.create({
      data: {
        number: 2000,
        rawNumber: 'RE-2026-2000',
        clientId: clients[4].id,
        companyId: companies[2].id,
        status: 'PAID',
        createdAt: new Date('2026-01-10'),
        dueDate: thirtyDaysFromNow,
        paidAt: new Date('2026-01-25'),
        totalHT: 12000,
        totalVAT: 2280,
        totalTTC: 14280,
        currency: Currency.EUR,
        notes: 'Engineering services',
      },
    }),
  ]);
  console.log('✓ Created 5 test invoices\n');

  // Create invitation codes
  console.log('Creating invitation codes...');
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await Promise.all([
    // Valid invitation for Acme
    prisma.invitation_code.create({
      data: {
        code: 'ACME-INVITE-001',
        createdById: users[1].id, // Admin of Acme
        companyId: companies[0].id,
        expiresAt: futureDate,
      },
    }),
    // Valid invitation for TechStart
    prisma.invitation_code.create({
      data: {
        code: 'TECH-INVITE-001',
        createdById: users[2].id, // Admin of TechStart
        companyId: companies[1].id,
        expiresAt: futureDate,
      },
    }),
    // Expired invitation
    prisma.invitation_code.create({
      data: {
        code: 'EXPIRED-INVITE-001',
        createdById: users[1].id,
        companyId: companies[0].id,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      },
    }),
    // Used invitation
    prisma.invitation_code.create({
      data: {
        code: 'USED-INVITE-001',
        createdById: users[2].id,
        companyId: companies[1].id,
        expiresAt: futureDate,
        usedAt: new Date(),
        usedById: users[3].id, // User who used it
      },
    }),
  ]);
  console.log('✓ Created 4 invitation codes\n');

  // Create payment methods
  console.log('Creating payment methods...');
  await Promise.all([
    prisma.paymentMethod.create({
      data: {
        companyId: companies[0].id,
        name: 'Bank Transfer (USD)',
        type: 'BANK_TRANSFER',
        details: 'Bank: Chase\nAccount: ****1234\nRouting: 021000021',
        isActive: true,
      },
    }),
    prisma.paymentMethod.create({
      data: {
        companyId: companies[0].id,
        name: 'PayPal Business',
        type: 'PAYPAL',
        details: 'paypal@acme.com',
        isActive: true,
      },
    }),
    prisma.paymentMethod.create({
      data: {
        companyId: companies[1].id,
        name: 'Virement Bancaire',
        type: 'BANK_TRANSFER',
        details: 'IBAN: FR76 3000 1000 0100 0000 0000 123',
        isActive: true,
      },
    }),
    prisma.paymentMethod.create({
      data: {
        companyId: companies[2].id,
        name: 'Überweisung',
        type: 'BANK_TRANSFER',
        details: 'IBAN: DE89 3704 0044 0532 0130 00',
        isActive: true,
      },
    }),
  ]);
  console.log('✓ Created 4 payment methods\n');

  // Summary
  console.log('🎉 Multi-tenant test seed completed!\n');
  console.log('=== TEST ACCOUNTS ===');
  console.log(`SuperAdmin: superadmin@test.com (access to all ${companies.length} companies)`);
  console.log(`Acme Admin: admin.acme@test.com (ADMIN of ${companies[0].name})`);
  console.log(`TechStart Admin: admin.techstart@test.com (ADMIN of ${companies[1].name})`);
  console.log(`Acme User: user.acme@test.com (USER of ${companies[0].name})`);
  console.log(`Multi-Company: multi@test.com (ADMIN of ${companies[0].name}, USER of ${companies[1].name})`);
  console.log('\n=== INVITATION CODES ===');
  console.log('ACME-INVITE-001 - Valid invitation for Acme Corporation');
  console.log('TECH-INVITE-001 - Valid invitation for TechStart France');
  console.log('EXPIRED-INVITE-001 - Expired invitation (for testing)');
  console.log('USED-INVITE-001 - Already used invitation (for testing)');
  console.log('\nPassword for all test accounts: Use your auth system to set passwords');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
