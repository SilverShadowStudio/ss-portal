import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Silver Shadow Studio'

interface TeamInvitationProps {
  inviterName?: string
  companyName?: string
  inviteUrl?: string
}

const TeamInvitationEmail = ({
  inviterName,
  companyName,
  inviteUrl,
}: TeamInvitationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      You've been invited to join {companyName || 'a team'} on {SITE_NAME}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You're invited</Heading>
        <Text style={text}>
          {inviterName ? `${inviterName} has` : 'You have been'} invited
          {' to join '}
          <strong>{companyName || 'a team'}</strong> on {SITE_NAME}.
        </Text>
        <Text style={text}>
          Click the button below to accept the invitation. You'll be able
          to sign in or create an account, then you'll have shared access
          to the team's projects.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={inviteUrl || '#'}>
            Accept invitation
          </Button>
        </Section>
        <Text style={smallText}>
          This invitation will expire in 7 days. If you weren't expecting
          this email, you can safely ignore it.
        </Text>
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TeamInvitationEmail,
  subject: (data: Record<string, any>) =>
    `You've been invited to join ${data?.companyName || 'a team'} on ${SITE_NAME}`,
  displayName: 'Team invitation',
  previewData: {
    inviterName: 'Jane Doe',
    companyName: 'Acme Studio',
    inviteUrl: 'https://portal.silvershadowstudio.com/accept-invite?token=sample',
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
  fontSize: '28px',
  fontWeight: 400,
  letterSpacing: '0.04em',
  color: '#1a1a1a',
  margin: '0 0 24px',
}
const text = {
  fontSize: '15px',
  color: '#3a3a3a',
  lineHeight: '1.6',
  margin: '0 0 18px',
}
const smallText = {
  fontSize: '13px',
  color: '#777',
  lineHeight: '1.5',
  margin: '24px 0 0',
}
const footer = {
  fontSize: '13px',
  color: '#999',
  margin: '32px 0 0',
}
const buttonContainer = {
  margin: '28px 0',
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