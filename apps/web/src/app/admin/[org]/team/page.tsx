'use client';

import Link from '@/components/admin/org-link';
import { useEffect, useState } from 'react';
import type { Member, ScopeType } from '@custock/core';
import { relative } from '@/lib/format';
import { useAdmin } from '@/components/admin/admin-context';
import { LevelPolicies } from '@/components/policy/level-policies';
import { Page } from '@/components/admin/shell';
import { Avatar, Group, Row } from '@/components/ui/kit';
import { Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { IconCheck, IconCopy, IconPlus, IconShare, IconShield } from '@/components/ui/icons';
import { basePath } from '@/lib/api-client';
import { useAsync } from '@/lib/use-async';
import { RedirectHome } from '@/components/admin/redirect-home';
import { normalizeEmail } from '@custock/core';
import { EmailInput } from '@/components/ui/field-kit';
import { roleNameLabel } from '@/lib/names';

export default function TeamPage() {
  const { api, org, t, can, locale } = useAdmin();
  const members = useAsync(() => (can('members.view', null) ? api.members(org.orgId) : Promise.resolve([])), []);
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<Member | null>(null);
  const toast = useToast();
  const invites = useAsync(() => (org.orgPerms.includes('members.invite') || org.shops.some((s) => s.perms.includes('members.invite')) ? api.invites(org.orgId) : Promise.resolve([])), [inviting]);
  const canInvite = !org.staffFull && (org.orgPerms.includes('members.invite') || org.shops.some((s) => s.perms.includes('members.invite')));
  // a notification about someone who just joined opens them (?member=), once, then the link is dropped
  useEffect(() => {
    if (!members.data) return;
    const u = new URL(window.location.href);
    const wanted = u.searchParams.get('member');
    if (!wanted) return;
    const m = members.data.find((x) => x.membershipId === wanted);
    if (m?.canManage) setManaging(m);
    u.searchParams.delete('member');
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
  }, [members.data]);
  if (!org.orgPerms.includes('members.view') && !org.shops.some((s) => s.perms.includes('members.view'))) return <RedirectHome />;

  return (
    <Page
      title={t('team.title')}
      actions={
        <>
          {can('roles.manage', null) ? <Link href="/admin/team/roles" className="btn btn-gray"><IconShield size={18} />{t('team.roles')}</Link> : null}
          {canInvite ? <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><IconPlus size={18} />{t('team.invite')}</button> : null}
        </>
      }
    >
      <Group title={t('team.members')}>
        {(members.data ?? []).map((m) => (
          <Row
            key={m.membershipId}
            leading={<Avatar name={m.name} src={m.avatarUrl} />}
            title={m.name}
            subtitle={
              <span className="block">
                {m.assignments.map((a) => `${roleNameLabel(t, a.roleName)} · ${a.scopeName}`).join(', ')}
              </span>
            }
            value={m.status === 'active' ? undefined : t(`team.status.${m.status}`)}
            onClick={m.canManage ? () => setManaging(m) : undefined}
            chevron={m.canManage}
          />
        ))}
        {!members.data ? <div className="row"><span className="w-9 h-9 rounded-full skel" /><span className="row-main"><span className="block h-4 w-1/3 skel" /></span></div> : null}
      </Group>
      {invites.data?.length ? (
        <Group title={t('team.pending')} footer={t('team.pendingFoot')}>
          {invites.data.map((i) => (
            <Row key={i.id} title={i.email} subtitle={`${roleNameLabel(t, i.roleName)} · ${t('team.expires', { when: relative(i.expiresAt, locale) })}`}
              trailing={<button type="button" className="btn btn-plain" style={{ color: 'var(--c-error)' }} onClick={() => void api.revokeInvite(org.orgId, i.id).then(() => { toast(t('team.revoked')); void invites.reload(); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)))}>{t('team.revoke')}</button>} />
          ))}
        </Group>
      ) : null}
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
      {managing ? <MemberSheet member={managing} onClose={() => setManaging(null)} onDone={() => { setManaging(null); void members.reload(); }} /> : null}
    </Page>
  );
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, org, t, shops, locale } = useAdmin();
  const toast = useToast();
  const orgWide = org.orgPerms.includes('members.invite');
  const scopes: { type: ScopeType; id: string; name: string }[] = [
    ...(orgWide ? [{ type: 'org' as const, id: org.orgId, name: t('common:scope.org') }] : []),
    ...shops.filter((s) => orgWide || org.shops.find((x) => x.shopId === s.id)?.perms.includes('members.invite')).map((s) => ({ type: 'shop' as const, id: s.id, name: s.name })),
  ];
  const [scope, setScope] = useState('0');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<string | null>(null);
  // the invite: the link to hand over, and whether it also went out by email
  const [done, setDone] = useState<{ link: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sc = scopes[Number(scope)];
  const roles = useAsync(() => (open && sc ? api.grantableRoles(org.orgId, sc.type, sc.id) : Promise.resolve([])), [open, scope]);
  const available = (roles.data ?? []).filter((r) => r.ok);
  const label = (r: { name: string }) => roleNameLabel(t, r.name);

  async function send() {
    if (!sc || !roleId) return;
    setError(null);
    try {
      const r = await api.invite(org.orgId, { email: normalizeEmail(email), roleId, scopeType: sc.type, scopeId: sc.id, locale: locale as 'en' });
      const link = /^https?:/.test(r.link) ? r.link : `${window.location.origin}${basePath}${r.link}`;
      setDone({ link, emailed: r.emailed });
      if (r.emailed) toast(t('team.invited', { email }));
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  function close() { setDone(null); setEmail(''); setRoleId(null); setError(null); onClose(); }
  const missing = !email.includes('@') ? t('team.needEmail') : !roleId ? t('team.needRole') : null;

  return (
    <Sheet open={open} onClose={close} title={t('team.invite')} error={error}
      footer={done == null ? (
        <>
          <button type="button" className="btn btn-primary btn-large" disabled={Boolean(missing)} onClick={() => void send()}>{t('team.send')}</button>
          {missing ? <p className="why-line">{missing}</p> : null}
        </>
      ) : <button type="button" className="btn btn-gray btn-large" onClick={close}>{t('common:action.done')}</button>}>
      {done != null ? (
        <div className="text-center py-4">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'color-mix(in srgb, var(--c-success) 14%, transparent)', color: 'var(--c-success)' }}><IconCheck size={28} /></span>
          {done.emailed ? (
            <>
              <p className="t-headline m-0">{t('team.invited', { email })}</p>
              <p className="t-sub t-2 mt-2">{t('team.invitedSub')}</p>
            </>
          ) : (
            <>
              <p className="t-headline m-0">{t('team.linkReady')}</p>
              <p className="t-sub t-2 mt-2">{t('team.linkReadySub', { email })}</p>
              <p className="t-foot tnum break-all text-left card p-3 mt-4 mb-3" style={{ background: 'var(--c-shelf)' }}>{done.link}</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <button type="button" className="btn btn-tinted" onClick={() => void navigator.clipboard.writeText(done.link).then(() => toast(t('links.copied')))}><IconCopy size={18} />{t('team.copyLink')}</button>
                {typeof navigator !== 'undefined' && 'share' in navigator ? (
                  <button type="button" className="btn btn-gray" onClick={() => void navigator.share({ title: t('team.shareTitle', { org: org.name }), text: t('team.shareText', { org: org.name }), url: done.link }).catch(() => {})}><IconShare size={18} />{t('common:action.share')}</button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="list mb-4" role="list">
            <li><label className="block"><span className="field-label">{t('team.email')}</span><EmailInput value={email} onChange={setEmail} enterKeyHint="done" /></label></li>
            <li className="row row-sep">
              <span className="row-main row-title">{t('team.where')}</span>
              <Picker variant="plain" label={t('team.where')} value={scope} onChange={(v) => { setScope(v); setRoleId(null); }} options={scopes.map((s, i) => ({ value: String(i), label: s.name }))} />
            </li>
          </ul>
          <section className="inset-group">
            <h3 className="inset-group-head">{t('team.role')}</h3>
            <ul className="list" role="list">
              {available.map((r) => (
                <li key={r.roleId}>
                  <button type="button" className="row" onClick={() => setRoleId(r.roleId)} aria-pressed={roleId === r.roleId}>
                    <span className="row-main row-title">{label(r)}</span>
                    {roleId === r.roleId ? <IconCheck size={20} style={{ color: 'var(--c-accent)' }} /> : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="inset-group-foot">{t('team.inviteFoot')}</p>
          </section>
        </>
      )}
    </Sheet>
  );
}

// change a member's status. remove asks once more inline. roles change through invite for now.
function MemberSheet({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const { api, org, t } = useAdmin();
  const toast = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function set(status: 'active' | 'suspended' | 'removed') {
    setError(null);
    try {
      await api.updateMember(org.orgId, member.membershipId, { status });
      toast(t(`team.done.${status}`, { name: member.name ?? '' }));
      onDone();
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }
  return (
    <Sheet open onClose={onClose} title={member.name ?? ''} error={error}>
      <div className="list mb-4">
        {member.assignments.map((a) => (
          <div key={a.id} className="row"><span className="row-main row-title">{roleNameLabel(t, a.roleName)}</span><span className="row-value">{a.scopeName}</span></div>
        ))}
      </div>
      <LevelPolicies level={{ kind: 'member', membershipId: member.membershipId }} title={t('team.limits')} />
      <div className="list mb-2 mt-4">
        {member.status === 'suspended'
          ? <button type="button" className="row" style={{ color: 'var(--c-accent)' }} onClick={() => void set('active')}><span className="row-main row-title">{t('team.reactivate')}</span></button>
          : <button type="button" className="row" onClick={() => void set('suspended')}><span className="row-main"><span className="row-title block">{t('team.suspend')}</span><span className="row-sub block">{t('team.suspendSub')}</span></span></button>}
        {confirmRemove
          ? <button type="button" className="row" style={{ color: 'var(--c-error)' }} onClick={() => void set('removed')}><span className="row-main"><span className="row-title block">{t('team.removeConfirm', { name: member.name ?? '' })}</span><span className="row-sub block">{t('team.removeSub')}</span></span></button>
          : <button type="button" className="row" style={{ color: 'var(--c-error)' }} onClick={() => setConfirmRemove(true)}><span className="row-main row-title">{t('team.remove')}</span></button>}
      </div>
    </Sheet>
  );
}
