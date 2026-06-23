import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Link, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Pitch Pledge"

interface EventStartup {
  display_name?: string | null
  image_url?: string | null
  website_link?: string | null
  dd_room_link?: string | null
  funding_goal?: number | null
  description?: string | null
}
interface EventFacilitator {
  display_name?: string | null
  image_url?: string | null
  bio?: string | null
}
interface EventDetails {
  description?: string | null
  startups?: EventStartup[]
  facilitators?: EventFacilitator[]
}

interface SessionInvitationProps {
  recipientName?: string
  roleName?: string
  sessionName?: string
  sessionDate?: string
  sessionTime?: string
  welcomeMessage?: string
  loginUrl?: string
  calendarUrl?: string
  contactEmail?: string
  eventDetails?: EventDetails
  /**
   * Optional cache-buster tag. When set (e.g. "Jun 23, 1:42 PM"), the subject
   * line, preview text, and a small in-body banner all change so Gmail won't
   * thread this resend under the prior invitation. Used by the admin's
   * "Force-resend" action when a user reports the original never arrived.
   */
  freshTag?: string
}

/**
 * Per-role list of profile fields the recipient should fill in once they log
 * in. Shown as a checklist in the invitation so startups and facilitators
 * know what to prepare. Investors have no required profile fields, so the
 * section is hidden for that role.
 */
const METADATA_BY_ROLE: Record<string, { label: string; required: boolean }[]> = {
  startup: [
    { label: 'Short pitch description (about two sentences)', required: true },
    { label: 'Funding goal (USD)', required: true },
    { label: 'Website link', required: false },
    { label: 'Due-diligence room link', required: false },
    { label: 'Logo or team photo', required: false },
  ],
  facilitator: [
    { label: 'Short bio (up to 500 characters)', required: false },
    { label: 'Profile photo', required: false },
  ],
}

const SessionInvitationEmail = ({
  recipientName,
  roleName = 'participant',
  sessionName = 'Upcoming Session',
  sessionDate = '',
  sessionTime = '',
  welcomeMessage = '',
  loginUrl = '',
  calendarUrl = '',
  contactEmail = '',
  eventDetails,
  freshTag,
}: SessionInvitationProps) => {
  const metadataItems = METADATA_BY_ROLE[roleName] || []
  const isInvestor = roleName === 'investor'
  const startups = eventDetails?.startups || []
  const facilitators = eventDetails?.facilitators || []
  const showEventDetails = isInvestor && (
    !!eventDetails?.description || startups.length > 0 || facilitators.length > 0
  )
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {freshTag
        ? `Resend (${freshTag}) — your invitation to ${sessionName}`
        : `You're invited to ${sessionName} — ${SITE_NAME}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        {freshTag && (
          <Section style={resendBanner}>
            <Text style={resendBannerText}>
              🔁 Resent {freshTag} — if you received the original, you can ignore this copy.
            </Text>
          </Section>
        )}
        <Heading style={h1}>
          {recipientName ? `Hello, ${recipientName}!` : 'Hello!'}
        </Heading>

        <Text style={text}>
          You've been registered as {roleName === 'investor' ? 'an' : 'a'} <strong>{roleName}</strong> for the upcoming session:
        </Text>

        <Section style={sessionBox}>
          <Text style={sessionTitle}>{sessionName}</Text>
          {sessionDate && <Text style={sessionDetail}>📅 {sessionDate}</Text>}
          {sessionTime && <Text style={sessionDetail}>🕐 {sessionTime}</Text>}
        </Section>

        {welcomeMessage && (
          <Text style={text}>{welcomeMessage}</Text>
        )}

        {metadataItems.length > 0 && (
          <Section style={metadataBox}>
            <Text style={metadataTitle}>What to fill in when you log in</Text>
            {metadataItems.map((item, i) => (
              <Text key={i} style={metadataItem}>
                • {item.label}
                {item.required ? <span style={requiredTag}> (required)</span> : null}
              </Text>
            ))}
          </Section>
        )}

        {loginUrl && (
          <Section style={{ textAlign: 'center' as const, margin: '25px 0' }}>
            <Button style={button} href={loginUrl}>
              Join Session
            </Button>
          </Section>
        )}

        {calendarUrl && (
          <Section style={{ textAlign: 'center' as const, marginBottom: '25px' }}>
            <Link href={calendarUrl} style={calendarLink}>
              📅 Add to Google Calendar
            </Link>
          </Section>
        )}

        {showEventDetails && (
          <Section style={detailsBox}>
            <Hr style={hr} />
            <Heading as="h2" style={h2}>About this event</Heading>
            {eventDetails?.description && (
              <Text style={text}>{eventDetails.description}</Text>
            )}

            {startups.length > 0 && (
              <>
                <Heading as="h3" style={h3}>Presenting startups</Heading>
                {startups.map((s, i) => (
                  <Section key={`s-${i}`} style={card}>
                    <Text style={cardTitle}>{s.display_name || 'Startup'}</Text>
                    {s.funding_goal != null && (
                      <Text style={cardMeta}>Goal: ${Number(s.funding_goal).toLocaleString()} (USD)</Text>
                    )}
                    {s.description && <Text style={cardBody}>{s.description}</Text>}
                    {(s.website_link || s.dd_room_link) && (
                      <Text style={cardLinks}>
                        {s.website_link && (
                          <Link href={s.website_link} style={linkStyle}>Website</Link>
                        )}
                        {s.website_link && s.dd_room_link ? '  •  ' : ''}
                        {s.dd_room_link && (
                          <Link href={s.dd_room_link} style={linkStyle}>DD Room</Link>
                        )}
                      </Text>
                    )}
                  </Section>
                ))}
              </>
            )}

            {facilitators.length > 0 && (
              <>
                <Heading as="h3" style={h3}>Hosts</Heading>
                {facilitators.map((f, i) => (
                  <Section key={`f-${i}`} style={card}>
                    <Text style={cardTitle}>{f.display_name || 'Host'}</Text>
                    {f.bio && <Text style={cardBody}>{f.bio}</Text>}
                  </Section>
                ))}
              </>
            )}
          </Section>
        )}

        <Hr style={hr} />

        <Text style={footer}>
          {contactEmail
            ? <>Questions? Contact <Link href={`mailto:${contactEmail}`} style={linkStyle}>{contactEmail}</Link></>
            : 'Questions? Contact your session facilitator.'}
        </Text>
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
  )
}

export const template = {
  component: SessionInvitationEmail,
  subject: (data: Record<string, any>) => {
    const base = `You're invited to ${data.sessionName || 'a session'} — ${SITE_NAME}`
    // freshTag breaks Gmail's subject-based threading so a resend lands as a
    // brand-new conversation rather than being collapsed under the original.
    return data.freshTag ? `${base} · resend (${data.freshTag})` : base
  },
  displayName: 'Session Invitation',
  previewData: {
    recipientName: 'Jane Doe',
    roleName: 'startup',
    sessionName: 'Q1 Demo Day',
    sessionDate: 'March 30, 2026',
    sessionTime: '9:00 AM — 11:00 AM ET',
    welcomeMessage: 'We look forward to seeing you at the pitch session!',
    loginUrl: 'https://pitch.globaldonut.com/login?session=abc&email=jane@example.com&role=startup',
    calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Q1+Demo+Day',
    contactEmail: 'facilitator@example.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 16px' }
const sessionBox = { backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '16px 20px', margin: '0 0 20px', border: '1px solid #bbf7d0' }
const sessionTitle = { fontSize: '17px', fontWeight: 'bold' as const, color: '#166534', margin: '0 0 6px' }
const sessionDetail = { fontSize: '14px', color: '#15803d', margin: '0 0 4px' }
const button = { backgroundColor: '#16a34a', color: '#ffffff', padding: '12px 28px', borderRadius: '6px', fontSize: '15px', fontWeight: 'bold' as const, textDecoration: 'none', display: 'inline-block' }
const calendarLink = { fontSize: '14px', color: '#16a34a', textDecoration: 'underline' }
const hr = { borderColor: '#e5e7eb', margin: '25px 0' }
const footer = { fontSize: '12px', color: '#999', margin: '0 0 4px' }
const linkStyle = { color: '#16a34a' }
const metadataBox = { backgroundColor: '#f9fafb', borderRadius: '8px', padding: '14px 18px', margin: '0 0 20px', border: '1px solid #e5e7eb' }
const metadataTitle = { fontSize: '14px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 8px' }
const metadataItem = { fontSize: '13px', color: '#333', lineHeight: '1.5', margin: '0 0 4px' }
const requiredTag = { color: '#b91c1c', fontWeight: 'bold' as const }
const h2 = { fontSize: '18px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 12px' }
const h3 = { fontSize: '15px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '18px 0 8px' }
const detailsBox = { margin: '0 0 16px' }
const card = { backgroundColor: '#f9fafb', borderRadius: '8px', padding: '12px 16px', margin: '0 0 10px', border: '1px solid #e5e7eb' }
const cardTitle = { fontSize: '14px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 4px' }
const cardMeta = { fontSize: '12px', color: '#666', margin: '0 0 6px' }
const cardBody = { fontSize: '13px', color: '#333', lineHeight: '1.5', margin: '0 0 6px' }
const cardLinks = { fontSize: '13px', color: '#16a34a', margin: '4px 0 0' }
const resendBanner = { backgroundColor: '#fef3c7', borderRadius: '6px', padding: '10px 14px', margin: '0 0 18px', border: '1px solid #fcd34d' }
const resendBannerText = { fontSize: '13px', color: '#92400e', margin: 0, lineHeight: '1.5' }
