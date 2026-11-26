/**
 * /invite/<token> — works for any signed-in account (new users included). The token is read
 * from the URL once, sent only in a POST body, and the URL is replaced so it does not stay in
 * history. Redeeming files an access request; the owner (or an admin) still approves it.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Users } from '../../components/icons';
import { Button, Notice, StateView } from '../../components/ui';
import type { FlowApp } from '../api';
import { errorText, ROLE_TEXT, useApp } from '../core';

type Inspect = Awaited<ReturnType<FlowApp['inspectInvitation']>>;

export function InviteView({
  api,
  token,
  onRequested,
}: {
  api: FlowApp;
  token: string;
  onRequested: () => void;
}) {
  const [info, setInfo] = useState<Inspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // LIFF has finished by the time this view mounts. Keep the token out of browser history.
    window.history.replaceState(window.history.state, '', '/groups');
    api.inspectInvitation(token).then(setInfo, (e) => setError(errorText(e)));
  }, [api, token]);

  if (error) return <Notice tone="caution">{error}</Notice>;
  if (!info) return <p className="f-hint">กำลังตรวจสอบลิงก์เชิญ…</p>;
  if (done)
    return (
      <StateView
        expression="happy"
        title="ส่งคำขอเข้าร่วมแล้วค่ะ"
        body="เจ้าของระบบจะเห็นคำขอในแอปทันที เมื่ออนุมัติแล้วกลุ่มจะปรากฏในหน้า “กลุ่ม” ของคุณ"
        action={<Button onClick={onRequested}>ตกลง</Button>}
      />
    );
  if (info.state !== 'valid') {
    const text = {
      used: 'ลิงก์เชิญนี้ถูกใช้ไปแล้ว',
      revoked: 'ลิงก์เชิญนี้ถูกยกเลิกแล้ว',
      expired: 'ลิงก์เชิญนี้หมดอายุแล้ว',
      invalid: 'ลิงก์เชิญไม่ถูกต้อง',
    }[info.state];
    return <StateView expression="empty" title={text} body="ขอลิงก์ใหม่จากผู้ที่เชิญคุณได้ค่ะ" />;
  }
  return (
    <div className="invite">
      <p className="invite__icon" aria-hidden>
        <Users />
      </p>
      <h2 className="f-name">คุณได้รับเชิญเข้ากลุ่ม “{info.workspaceName}”</h2>
      <p className="f-muted">บทบาท: {info.role ? ROLE_TEXT[info.role] : '-'} · ลิงก์ใช้ได้ครั้งเดียว</p>
      <Notice tone="info">
        การเข้าร่วมต้องได้รับการอนุมัติจากเจ้าของระบบก่อน ลิงก์เชิญไม่ได้ให้สิทธิ์ผู้ดูแลระบบใด ๆ
      </Notice>
      <Button
        variant="dark"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.redeemInvitation(token);
            setDone(true);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        ขอเข้าร่วมกลุ่ม
      </Button>
    </div>
  );
}

export function InvitePage() {
  const { api, reloadMe } = useApp();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  return (
    <section className="page">
      <InviteView
        key={token}
        api={api}
        token={token}
        onRequested={() => {
          void reloadMe();
          navigate('/groups', { replace: true });
        }}
      />
    </section>
  );
}
