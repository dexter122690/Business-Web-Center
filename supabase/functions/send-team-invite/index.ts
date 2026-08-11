import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authorization = request.headers.get('Authorization') || ''
  if (!url || !anonKey || !serviceKey || !authorization) {
    return json({ error: 'The invitation email service is not configured.' }, 500)
  }

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userResult, error: userError } = await callerClient.auth.getUser()
  const caller = userResult?.user
  if (userError || !caller) return json({ error: 'Please sign in again.' }, 401)

  let body: { inviteId?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid invitation request.' }, 400)
  }
  if (!body.inviteId) return json({ error: 'Invitation ID is required.' }, 400)

  const { data: invite, error: inviteError } = await admin
    .from('business_team_invites')
    .select('id,business_id,branch_id,email,full_name,role,status')
    .eq('id', body.inviteId)
    .maybeSingle()
  if (inviteError || !invite) return json({ error: 'Team invitation was not found.' }, 404)

  const { data: membership } = await admin
    .from('business_memberships')
    .select('role,status')
    .eq('business_id', invite.business_id)
    .eq('user_id', caller.id)
    .maybeSingle()
  if (!membership || membership.role !== 'owner' || membership.status !== 'active') {
    return json({ error: 'Only the active business owner can send team invitations.' }, 403)
  }

  const siteUrl = (Deno.env.get('SITE_URL') || 'https://www.business-web-center.com').replace(/\/$/, '')
  const inviteRedirect = `${siteUrl}/auth.html?team-invite=1`
  const signInRedirect = `${siteUrl}/auth.html?team-signin=1`

  // Supabase Auth does not send a second account invitation to an existing user.
  // For an existing account, send a secure sign-in link through the same configured SMTP.
  let existingUser = false
  for (let page = 1; page <= 20 && !existingUser; page += 1) {
    const { data: users, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) return json({ error: error.message }, 500)
    existingUser = Boolean(users.users.find((item) => item.email?.toLowerCase() === invite.email.toLowerCase()))
    if (users.users.length < 100) break
  }

  let sendError: { message: string } | null = null
  if (existingUser) {
    const mailClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const result = await mailClient.auth.signInWithOtp({
      email: invite.email,
      options: { shouldCreateUser: false, emailRedirectTo: signInRedirect },
    })
    sendError = result.error
  } else {
    const result = await admin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: inviteRedirect,
      data: {
        full_name: invite.full_name,
        joining_existing_team: true,
        business_id: invite.business_id,
        branch_id: invite.branch_id,
        team_role: invite.role,
      },
    })
    sendError = result.error
  }

  if (sendError) {
    await admin.from('business_team_invites').update({
      email_delivery_status: 'failed',
      email_delivery_error: sendError.message,
    }).eq('id', invite.id)
    return json({ error: sendError.message }, 400)
  }

  await admin.from('business_team_invites').update({
    email_delivery_status: 'sent',
    email_sent_at: new Date().toISOString(),
    email_delivery_error: null,
  }).eq('id', invite.id)

  return json({
    sent: true,
    existingAccount: existingUser,
    message: existingUser
      ? `A secure sign-in email was sent to ${invite.email}.`
      : `An account invitation email was sent to ${invite.email}.`,
  })
})
