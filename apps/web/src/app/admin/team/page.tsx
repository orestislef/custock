'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ScopeType } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Group, Row, Why } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconCheck, IconLock, IconPlus, IconShield } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';

export default function TeamPage() {
  const { api, org, t, can } = useAdmin();
  const members = useAsync(() => (can('members.view', null) ? api.members(org.orgId) : Promise.resolve([])), []);
  const [inviting, setInviting] = useState(false);
  const canInvite = org.orgPerms.includes('members.invite') || org.shops.some((s) => s.perms.includes('members.invite'));

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
      <Group title={t('team.members')} footer={t('team.rulesFoot')}>
        {(members.data ?? []).map((m) => (
          <Row
            key={m.membershipId}
            leading={<Avatar name={m.name} />}
            title={m.name}
            subtitle={
              <span className="block">
                {m.assignments.map((a) => `${t(`common:role.${a.roleName}`, { defaultValue: a.roleName })} · ${a.scopeName}`).join(', ')}
                {!m.canManage && m.manageBlockedBy ? <span className="block mt-0.5"><Why>{t(`team.blocked.${m.manageBlockedBy}`, { defaultValue: t(`common:error.${m.manageBlockedBy}`) })}</Why></span> : null}
              </span>
            }
            value={m.status === 'active' ? undefined : t(`team.status.${m.status}`)}
          />
        ))}
        {!members.data ? <div className="row"><span className="w-9 h-9 rounded-full skel" /><span className="row-main"><span className="block h-4 w-1/3 skel" /></span></div> : null}
      </Group>
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
    </Page>
  );
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, org, t, shops } = useAdmin();
  const toast = useToast();
  const orgWide = org.orgPerms.includes('members.invite');
  const scopes: { type: ScopeType; id: string; name: string }[] = [
    ...(orgWide ? [{ type: 'org' as const, id: org.orgId, name: t('common:scope.org') }] : []),
    ...shops.filter((s) => orgWide || org.shops.find((x) => x.shopId === s.id)?.perms.includes('members.invite')).map((s) => ({ type: 'shop' as const, id: s.id, name: s.name })),
  ];
  const [scope, setScope] = useState(0);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sc = scopes[scope];
  const roles = useAsync(() => (open && sc ? api.grantableRoles(org.orgId, sc.type, sc.id) : Promise.resolve([])), [open, scope]);

  async function send() {
    if (!sc || !roleId) return;
    try {
      const r = await api.invite(org.orgId, { email: email.trim(), roleId, scopeType: sc.type, scopeId: sc.id, locale: 'el' });
      setDone(r.devLink ?? '');
      toast(t('team.invited', { email }));
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  function close() { setDone(null); setEmail(''); setRoleId(null); onClose(); }

  return (
    <Sheet open={open} onClose={close} title={t('team.invite')}
      footer={done == null ? <button type="button" className="btn btn-primary btn-large" disabled={!email.includes('@') || !roleId} onClick={() => void send()}>{t('team.send')}</button> : <button type="button" className="btn btn-gray btn-large" onClick={close}>{t('common:action.done')}</button>}>
      {done != null ? (
        <div className="text-center py-4">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'color-mix(in srgb, var(--c-success) 14%, transparent)', color: 'var(--c-success)' }}><IconCheck size={28} /></span>
          <p className="t-headline m-0">{t('team.invited', { email })}</p>
          <p className="t-sub t-2 mt-2">{t('team.invitedSub')}</p>
          {done ? <p className="t-foot t-2 mt-3 break-all">{t('team.devLink')}: {done}</p> : null}
        </div>
      ) : (
        <>
          <div className="list mb-4">
            <input className="field" type="email" inputMode="email" placeholder={t('team.email')} aria-label={t('team.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="row row-sep relative">
              <span className="row-main row-title">{t('team.where')}</span>
              <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={scope} onChange={(e) => { setScope(Number(e.target.value)); setRoleId(null); }}>
                {scopes.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <section className="group">
            <h3 className="group-head">{t('team.role')}</h3>
            <div className="list">
              {(roles.data ?? []).map((r) => (
                <button key={r.roleId} type="button" className="row" disabled={!r.ok} onClick={() => setRoleId(r.roleId)} aria-pressed={roleId === r.roleId}>
                  <span className="row-main">
                    <span className="row-title block" style={{ color: r.ok ? 'var(--c-ink)' : 'var(--c-ink-3)' }}>{t(`common:role.${r.name}`, { defaultValue: r.name })}</span>
                    {!r.ok && r.blockedBy ? <span className="row-sub block"><Why>{t(`team.why.${r.blockedBy}`, { defaultValue: t(`common:error.${r.blockedBy}`) })}</Why></span> : null}
                  </span>
                  {roleId === r.roleId ? <IconCheck size={20} style={{ color: 'var(--c-accent)' }} /> : !r.ok ? <IconLock size={16} style={{ color: 'var(--c-ink-3)' }} /> : null}
                </button>
              ))}
            </div>
            <p className="group-foot">{t('team.inviteFoot')}</p>
          </section>
        </>
      )}
    </Sheet>
  );
}
