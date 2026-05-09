import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Silver Shadow Studio'

interface NewAccountNotificationProps {
  companyName?: string
  signatoryName?: string
  signatoryPosition?: string
  email?: string
  country?: string
  signedAt?: string
  adminUrl?: string
}

const NewAccountNotificationEmail = ({
  companyName,
  signatoryName,
  signatoryPosition,
  email,
  country,
  signedAt,
  adminUrl,
}: NewAccountNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      New client signed up: {companyName || 'a new account'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New client registered</Heading>
        <Text style={text}>
          A new account has just signed the Services Agreement on{' '}
          {SITE_NAME}.
        </Text>

        <Section style={card}>
          <Text style={label}>COMPANY</Text>
          <Text style={value}>{companyName || '—'}</Text>

          <Hr style={divider} />

          <Text style={label}>SIGNATORY</Text>
          <Text style={value}>
            {signatoryName || '—'}
            {signatoryPosition ? ` · ${signatoryPosition}` : ''}
          </Text>

          <Hr style={divider} />

          <Text style={label}>EMAIL</Text>
          <Text style={value}>{email || '—'}</Text>

          {country ? (
            <>
              <Hr style={divider} />
              <Text style={label}>COUNTRY</Text>
              <Text style={value}>{country}</Text>
            </>
          ) : null}

          {signedAt ? (
            <>
              <Hr style={divider} />
              <Text style={label}>SIGNED AT</Text>
              <Text style={value}>{signedAt}</Text>
            </>
          ) : null}
        </Section>

        <Section style={buttonContainer}>
          <Button style={button} href={adminUrl || '#'}>
            Open admin dashboard
          </Button>
        </Section>

        <Text style={footer}>— The {SITE_NAME} system</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NewAccountNotificationEmail,
  subject: (data: Record<string, any>) =>
    `New client signed up — ${data?.companyName || 'New account'}`,
  displayName: 'New account notification (admin)',
  previewData: {
    companyName: 'Acme Holdings Ltd',
    signatoryName: 'Jane Doe',
    signatoryPosition: 'Director',
    email: 'jane@acme.com',
    country: 'United Kingdom',
    signedAt: new Date().toISOString(),
    adminUrl: 'https://ss-client.lovable.app/admin/clients',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Montserrat, Arial, sans-serif',
  color: '#1a1a1a',
}
const container = {
  padding: '40px 32px',
  maxWidth: '560px',
  margin: '0 auto',
}
const h1 = {
  fontFamily: 'Cinzel, Georgia, serif',
  fontSize: '26px',
  fontWeight: 400,
  letterSpacing: '0.04em',
  color: '#1a1a1a',
  margin: '0 0 20px',
}
const text = {
  fontSize: '15px',
  color: '#3a3a3a',
  lineHeight: '1.6',
  margin: '0 0 18px',
}
const card = {
  border: '1px solid #eee',
  borderRadius: '4px',
  padding: '20px 24px',
  margin: '20px 0 8px',
  backgroundColor: '#fafafa',
}
const label = {
  fontSize: '10px',
  letterSpacing: '0.18em',
  color: '#999',
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
  fontWeight: 600,
}
const value = {
  fontSize: '14px',
  color: '#1a1a1a',
  margin: '0 0 4px',
}
const divider = {
  borderColor: '#ececec',
  margin: '14px 0',
}
const buttonContainer = {
  margin: '28px 0 8px',
}
const button = {
  backgroundColor: '#BCA88E',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '2px',
  display: 'inline-block',
}
const footer = {
  fontSize: '13px',
  color: '#999',
  margin: '32px 0 0',
}