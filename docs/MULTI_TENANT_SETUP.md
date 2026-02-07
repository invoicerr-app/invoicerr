# Multi-Tenant Setup Guide

## Overview

This document describes the multi-tenant architecture implemented in Invoicerr, which enables multiple companies (tenants) to share a single application instance while keeping their data completely isolated.

## Architecture

### Core Concepts

- **Tenant**: A company/organization using the application
- **User**: An individual account that can belong to multiple tenants
- **Role**: Defines permissions within a tenant context
- **Data Isolation**: Each tenant's data is completely separate from others

### Database Schema

The multi-tenant system uses a **junction table pattern** for user-company relationships:

```
User (1) ---- (*) UserCompany (*) ---- (1) Company
```

This many-to-many relationship allows:
- Users to belong to multiple companies
- Users to have different roles in different companies
- Flexible permission management per company context

### User Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| **SUPERADMIN** | System-level administrator | Full access to all companies, system settings, user management |
| **ADMIN** | Company administrator | Full access to assigned company, can invite users, manage company settings |
| **USER** | Regular user | Limited access to assigned company, can create/view invoices and clients |

### Role Hierarchy

```
SUPERADMIN
    └── Can access all companies
    └── Can manage system settings
    └── Can manage all users

ADMIN
    └── Can manage their company
    └── Can invite users to their company
    └── Can manage company settings

USER
    └── Can use application features
    └── Cannot invite users
    └── Cannot access admin features
```

## API Endpoints

### Authentication

All endpoints require authentication via session token (better-auth).

### Company Context

Most endpoints require a `companyId` parameter to specify which company's data to access:

```http
GET /api/invoices?companyId={companyId}
POST /api/clients?companyId={companyId}
```

### Role-Based Endpoints

#### Superadmin Only

```http
GET    /api/admin/companies          # List all companies
GET    /api/admin/users              # List all users
POST   /api/admin/companies          # Create new company
DELETE /api/admin/companies/:id      # Delete company
```

#### Admin and Above

```http
POST   /api/invitations              # Create invitation
GET    /api/invitations              # List company invitations
DELETE /api/invitations/:id          # Revoke invitation
GET    /api/company/members          # List company members
PUT    /api/company/members/:id/role # Update member role
```

#### All Authenticated Users

```http
GET    /api/clients                  # List clients
POST   /api/clients                  # Create client
GET    /api/invoices                 # List invoices
POST   /api/invoices                 # Create invoice
GET    /api/quotes                   # List quotes
POST   /api/quotes                   # Create quote
GET    /api/settings                 # Get company settings
```

## Migration Guide

### Prerequisites

- PostgreSQL database with existing data
- Backup of production database
- Application stopped

### Running the Migration

1. **Backup your database:**
   ```bash
   pg_dump -h localhost -U username invoicerr > backup.sql
   ```

2. **Run the migration:**
   ```bash
   cd backend
   npx prisma migrate deploy
   ```

3. **Verify migration:**
   ```bash
   npx prisma migrate status
   ```

4. **Seed test data (optional):**
   ```bash
   npx tsx prisma/seed-multi-tenant.ts
   ```

### What the Migration Does

1. Creates `UserRole` enum (SUPERADMIN, ADMIN, USER)
2. Creates `UserCompany` junction table
3. Adds `companyId` to `InvitationCode` table
4. Migrates existing users:
   - First user (oldest) becomes SUPERADMIN of all companies
   - Other users are matched to companies by email and assigned USER role

### Rollback (if needed)

```bash
# Run down migration
psql -h localhost -U username invoicerr < prisma/migrations/20260207000000_multi_tenant_setup/down.sql
```

## Testing

### Running E2E Tests

```bash
# Start test environment
docker-compose -f docker-compose.test.yml up -d

# Run backend tests
cd backend
npm run test:e2e -- multi-tenant.e2e-spec.ts

# Run Cypress tests
cd e2e
npm run cypress:run -- --spec "cypress/e2e/13-multi-tenant.cy.ts"
```

### Test Scenarios Covered

1. **Role Assignment**
   - First user becomes SUPERADMIN automatically
   - Users can have different roles in different companies
   - Role inheritance and permissions

2. **Data Isolation**
   - Clients isolated by company
   - Invoices isolated by company
   - Settings isolated by company
   - Cross-company access prevented

3. **Company Switching**
   - Context switching for multi-company users
   - Data updates when switching companies
   - UI reflects current company context

4. **Invitations**
   - Admins can create company-specific invitations
   - Users cannot create invitations
   - Invitation codes linked to companies

5. **Security**
   - URL manipulation attempts blocked
   - API access controlled by roles
   - Data access verified per request

## Local Development Setup

### 1. Database Setup

```bash
cd backend
npx prisma migrate dev
npx tsx prisma/seed-multi-tenant.ts
```

### 2. Test Accounts

After seeding, the following test accounts are available:

| Email | Role | Companies |
|-------|------|-----------|
| superadmin@test.com | SUPERADMIN | All 3 companies |
| admin.acme@test.com | ADMIN | Acme Corporation |
| admin.techstart@test.com | ADMIN | TechStart France |
| user.acme@test.com | USER | Acme Corporation |
| multi@test.com | ADMIN/USER | Acme (ADMIN), TechStart (USER) |

Password: `Super_Secret_Password123!`

### 3. Testing Company Switching

1. Login as `multi@test.com`
2. Observe company switcher in sidebar
3. Click switcher and select different company
4. Verify data changes (different clients, invoices)

### 4. Testing Role Permissions

1. Login as `user.acme@test.com`
2. Go to Settings
3. Verify "Invite User" button is hidden
4. Login as `admin.acme@test.com`
5. Verify "Invite User" button is visible

## Breaking Changes

### API Changes

- All data endpoints now require `companyId` parameter
- User object no longer directly contains company info
- New middleware enforces role-based access control

### Database Changes

- New `user_company` table
- New `UserRole` enum
- `companyId` added to `invitation_code`
- Existing users must be assigned to companies

### Migration Notes

- **Backward Compatible**: Existing single-tenant setups continue working
- **First User**: Automatically promoted to SUPERADMIN
- **Other Users**: Matched to companies by email heuristic
- **Manual Review**: Recommended to verify role assignments after migration

## Best Practices

### For Developers

1. **Always check company context** in API handlers
2. **Validate user role** before allowing admin operations
3. **Use transactions** when modifying multi-tenant data
4. **Test with multiple companies** during development

### For Administrators

1. **Review user roles** after migration
2. **Use strong passwords** for SUPERADMIN accounts
3. **Regular backups** of tenant data
4. **Monitor invitation usage** for security

### For Users

1. **Verify company context** before creating data
2. **Use invitations** for adding team members
3. **Contact admin** for role changes
4. **Report** any cross-company data visibility

## Troubleshooting

### Common Issues

#### User sees no companies after migration

**Cause**: User not assigned to any company
**Solution**: SUPERADMIN must manually add user to company via admin panel

#### Cannot create invitations

**Cause**: User has USER role instead of ADMIN
**Solution**: ADMIN or SUPERADMIN must upgrade user's role

#### Data appears from wrong company

**Cause**: Company context not properly switched
**Solution**: Clear browser cache, re-login, verify company switcher shows correct company

#### Migration fails with foreign key errors

**Cause**: Existing data references
**Solution**: Run migration in order, ensure all previous migrations applied

### Debug Commands

```bash
# Check migration status
npx prisma migrate status

# View user-company assignments
npx prisma studio

# Reset database (development only)
npx prisma migrate reset

# View logs
docker-compose logs backend
```

## Security Considerations

1. **Data Isolation**: Database-level constraints prevent cross-tenant data leaks
2. **Role Validation**: Middleware checks roles on every request
3. **Invitation Security**: Codes are single-use and expire
4. **Audit Trail**: All role changes and company switches are logged

## Future Enhancements

- [ ] Row-level security policies in PostgreSQL
- [ ] Custom roles beyond the three defaults
- [ ] Company-specific feature flags
- [ ] Data export per tenant
- [ ] Tenant-specific integrations

## Support

For issues or questions:
- Review test files for implementation examples
- Check API documentation for endpoint details
- Contact development team for migration assistance
