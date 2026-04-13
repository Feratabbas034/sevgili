import React, { useEffect, useMemo, useState } from 'react';

const SESSION_KEY = 'heartquest.session.v1';
const ADMIN_KEY_STORAGE = 'heartquest.admin-key.v1';
const puzzleSequence = ['moon', 'vinyl', 'spark'];

const questionDeck = [
  {
    id: 'hobby',
    prompt: 'Beraber en cok hangisini yapmak isterdin?',
    options: [
      'Gece yuruyusu + kahve',
      'Tatli bir kafe turu',
      'Sahilde uzun sohbet',
      'Plansiz minik bir kacamak',
    ],
  },
  {
    id: 'music',
    prompt: 'Bu hikayenin soundtracki hangisi olsun?',
    options: [
      'Yavas ve romantik',
      'Enerjik ve komik',
      'Indie ve sicak',
      'Eski sarkilar + nostalji',
    ],
  },
  {
    id: 'date',
    prompt: 'Ilk bulusma enerjisi hangisi?',
    options: [
      'Sade ama ozel',
      'Bol gulmeli oyunlu',
      'Biraz surprizli',
      'Tamamen spontene',
    ],
  },
];

const emptyStore = { sessions: [] };

function formatTime(value) {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function createFingerprint() {
  return [
    navigator.platform || 'unknown-platform',
    navigator.language || 'unknown-language',
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown-timezone',
  ].join(' | ');
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `API error: ${response.status}`);
  }

  return response.json();
}

function App() {
  const isAdminRoute = window.location.pathname.startsWith('/admin');
  const [typedClue, setTypedClue] = useState('');
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(SESSION_KEY) || '');
  const [isBooting, setIsBooting] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) || '');
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) || '');
  const [adminStore, setAdminStore] = useState(emptyStore);
  const [adminError, setAdminError] = useState('');

  const responses = currentSession?.responses || {};
  const puzzleSolved = (responses.puzzle || []).join('|') === puzzleSequence.join('|');
  const allAnswered = questionDeck.every((item) => responses[item.id]) && responses.memory;
  const stage = responses.finalAnswer ? 3 : allAnswered ? 2 : puzzleSolved ? 1 : 0;

  const progress = useMemo(() => {
    const answered = Object.keys(responses).length;
    return Math.min(100, Math.round((answered / (questionDeck.length + 2)) * 100));
  }, [responses]);

  const allLogs = useMemo(
    () =>
      (adminStore.sessions || [])
        .flatMap((session) => (session.logs || []).map((log) => ({ ...log, sessionId: session.id })))
        .sort((a, b) => b.at - a.at),
    [adminStore.sessions],
  );

  const dashboardStats = useMemo(() => {
    const sessions = adminStore.sessions || [];
    return {
      totalLogs: allLogs.length,
      totalSessions: sessions.length,
      acceptedSessions: sessions.filter((item) => item.status === 'accepted').length,
    };
  }, [adminStore.sessions, allLogs.length]);

  useEffect(() => {
    let active = true;

    async function bootPlay() {
      if (isAdminRoute) {
        setIsBooting(false);
        return;
      }

      try {
        const savedId = localStorage.getItem(SESSION_KEY);

        if (savedId) {
          try {
            const existing = await api(`/api/session/${savedId}`);
            if (!active) {
              return;
            }
            setCurrentSession(existing.session);
            setSessionId(existing.session.id);
            return;
          } catch {
            localStorage.removeItem(SESSION_KEY);
          }
        }

        const created = await api('/api/session', {
          method: 'POST',
          body: JSON.stringify({
            fingerprint: createFingerprint(),
            userAgent: navigator.userAgent,
          }),
        });

        if (!active) {
          return;
        }

        setCurrentSession(created.session);
        setSessionId(created.session.id);
        localStorage.setItem(SESSION_KEY, created.session.id);
      } finally {
        if (active) {
          setIsBooting(false);
        }
      }
    }

    bootPlay();

    return () => {
      active = false;
    };
  }, [isAdminRoute]);

  useEffect(() => {
    let active = true;

    async function loadAdmin() {
      if (!isAdminRoute || !adminKey) {
        return;
      }

      try {
        const payload = await api('/api/admin/state', {
          headers: {
            'x-admin-key': adminKey,
          },
        });

        if (!active) {
          return;
        }

        setAdminStore(payload);
        setAdminError('');
      } catch (error) {
        if (!active) {
          return;
        }

        setAdminStore(emptyStore);
        setAdminError(error.message);
      }
    }

    loadAdmin();

    return () => {
      active = false;
    };
  }, [adminKey, isAdminRoute]);

  async function refreshCurrentSession() {
    if (!sessionId) {
      return;
    }

    const payload = await api(`/api/session/${sessionId}`);
    setCurrentSession(payload.session);
  }

  async function pushEvent(payload) {
    if (!currentSession?.id) {
      return;
    }

    setIsSyncing(true);

    try {
      const result = await api('/api/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: currentSession.id,
          ...payload,
        }),
      });

      setCurrentSession(result.session);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handlePuzzlePick(item) {
    const nextValue = [...(responses.puzzle || []), item].slice(0, 3);
    const isSolved = nextValue.join('|') === puzzleSequence.join('|');

    await pushEvent({
      type: isSolved ? 'puzzle_solved' : 'puzzle_attempt',
      label: isSolved ? 'Bulmaca cozuldu' : 'Bulmaca denemesi',
      detail: isSolved ? 'Kalp kapsulu acildi' : `Secilen siralama: ${nextValue.join(' > ')}`,
      responsePatch: { puzzle: nextValue },
    });
  }

  async function resetPuzzle() {
    await pushEvent({
      type: 'puzzle_reset',
      label: 'Bulmaca sifirlandi',
      detail: 'Siralama tekrar temizlendi',
      responsePatch: { puzzle: [] },
    });
  }

  async function answerQuestion(questionId, answer) {
    await pushEvent({
      type: 'question_answered',
      label: 'Soru cevaplandi',
      detail: `${questionId}: ${answer}`,
      responsePatch: { [questionId]: answer },
    });
  }

  async function submitClue(event) {
    event.preventDefault();
    if (!typedClue.trim()) {
      return;
    }

    await pushEvent({
      type: 'memory_saved',
      label: 'Tatli not birakildi',
      detail: typedClue.trim(),
      responsePatch: { memory: typedClue.trim() },
    });

    setTypedClue('');
  }

  async function chooseFinal(answer) {
    await pushEvent({
      type: 'final_answer',
      label: answer === 'yes' ? 'Teklif kabul edildi' : 'Teklif dusunmeye alindi',
      detail:
        answer === 'yes'
          ? 'Birlikte cikma teklifine evet denildi'
          : 'Karar icin biraz daha zaman istendi',
      responsePatch: { finalAnswer: answer },
      status: answer === 'yes' ? 'accepted' : 'thinking',
    });
  }

  function submitAdminKey(event) {
    event.preventDefault();
    const nextValue = adminKeyInput.trim();
    setAdminKey(nextValue);
    localStorage.setItem(ADMIN_KEY_STORAGE, nextValue);
  }

  function logoutAdmin() {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminKey('');
    setAdminKeyInput('');
    setAdminStore(emptyStore);
  }

  if (isBooting && !isAdminRoute) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Heart Quest</span>
            <h1>Oturum hazirlaniyor.</h1>
            <p>Sunucudaki kayitlar yukleniyor ve yeni ziyaret aciliyor.</p>
          </div>
        </section>
      </main>
    );
  }

  if (isAdminRoute) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">Observer Board</span>
            <h1>Luna Protocol Admin</h1>
          </div>
        </header>

        {!adminKey || adminError ? (
          <section className="hero-panel admin-panel">
            <div className="hero-copy">
              <span className="eyebrow">Protected Route</span>
              <h1>Dashboard kilitli.</h1>
              <p>Yalnizca admin anahtarini bilen kisi loglari gorebilir.</p>
            </div>

            <form className="admin-form" onSubmit={submitAdminKey}>
              <label>
                <span>Admin anahtari</span>
                <input
                  type="password"
                  value={adminKeyInput}
                  onChange={(event) => setAdminKeyInput(event.target.value)}
                  placeholder="ADMIN_KEY"
                />
              </label>
              <button className="primary-btn" type="submit">
                Giris yap
              </button>
              {adminError && <p className="error-copy">{adminError}</p>}
            </form>
          </section>
        ) : (
          <div className="dashboard-shell">
            <section className="dashboard-hero">
              <div>
                <span className="eyebrow">Observer Board</span>
                <h2>Her hareket burada kalir.</h2>
                <p>
                  Ziyaretler, cevaplar, puzzle denemeleri ve final kararlar tum cihazlarda ayni
                  dashboard’da toplanir.
                </p>
              </div>
              <div className="metric-row">
                <article className="metric-card">
                  <span>Toplam hareket</span>
                  <strong>{dashboardStats.totalLogs}</strong>
                </article>
                <article className="metric-card">
                  <span>Toplam oturum</span>
                  <strong>{dashboardStats.totalSessions}</strong>
                </article>
                <article className="metric-card">
                  <span>Kabul sayisi</span>
                  <strong>{dashboardStats.acceptedSessions}</strong>
                </article>
              </div>
            </section>

            <section className="dashboard-grid">
              <article className="panel-card">
                <div className="panel-title">
                  <h3>Son Oturumlar</h3>
                  <span>IP ve durum</span>
                </div>
                <div className="response-list">
                  {(adminStore.sessions || []).slice(0, 6).map((session) => (
                    <div key={session.id} className="response-item">
                      <span>{session.status}</span>
                      <strong>
                        {session.ip} | {formatTime(session.startedAt)}
                      </strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel-card">
                <div className="panel-title">
                  <h3>Yanitlar</h3>
                  <span>Secili oturum yok, toplu gorunum var</span>
                </div>
                <div className="response-list">
                  {(adminStore.sessions || []).slice(0, 6).map((session) => (
                    <div key={session.id} className="response-item">
                      <span>{session.id}</span>
                      <strong>{session.responses?.finalAnswer || session.responses?.memory || 'Cevap akisi suruyor'}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel-card panel-card--wide">
                <div className="panel-title">
                  <h3>Butun Hareket Akisi</h3>
                  <span>En yeni ustte</span>
                </div>
                <div className="timeline">
                  {allLogs.length === 0 && <p className="empty-copy">Henuz hareket kaydi yok.</p>}
                  {allLogs.map((item) => (
                    <div key={item.id} className="timeline-row">
                      <div className={`dot dot--${item.type}`} />
                      <div className="timeline-copy">
                        <div className="timeline-head">
                          <strong>{item.label}</strong>
                          <span>{formatTime(item.at)}</span>
                        </div>
                        <p>{item.detail}</p>
                        <small>
                          IP: {item.ip} | Oturum: {item.sessionId}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <div className="admin-actions">
              <button className="ghost-btn" onClick={() => api('/api/admin/state', { headers: { 'x-admin-key': adminKey } }).then(setAdminStore)}>
                Yenile
              </button>
              <button className="ghost-btn" onClick={logoutAdmin}>
                Cikis
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Romantic Ops</span>
          <h1>Luna Protocol</h1>
        </div>
        <nav className="nav-switch">
          <button className="nav-btn nav-btn--active" type="button">
            Ana Sayfa
          </button>
          <button className="nav-btn" type="button" onClick={refreshCurrentSession}>
            Yenile
          </button>
        </nav>
      </header>

      <div className="play-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Heart Quest</span>
            <h1>Bir tekliften once kucuk bir oyun.</h1>
            <p>
              Bu sayfa sadece "beni seviyor musun?" demiyor. Biraz ritim, biraz merak,
              biraz da "biz nasil oluruz?" hissi soruyor.
            </p>
          </div>

          <div className="status-card">
            <div>
              <span>Canli oturum</span>
              <strong>{currentSession?.ip || 'Bilinmiyor'}</strong>
            </div>
            <div>
              <span>Kayit durumu</span>
              <strong>{isSyncing ? 'Yaziliyor' : 'Senkron'}</strong>
            </div>
            <div>
              <span>Ilerleme</span>
              <strong>%{progress}</strong>
            </div>
          </div>
        </section>

        <section className="game-grid">
          <article className="stage-card stage-card--wide">
            <div className="card-heading">
              <span>01</span>
              <div>
                <h2>Kilitli kapsul</h2>
                <p>Dogru sirayla uc sembol sec. Ipucu: gece, muzik, kivilcim.</p>
              </div>
            </div>

            <div className="token-row">
              {['moon', 'vinyl', 'spark', 'rose', 'ticket'].map((item) => (
                <button
                  key={item}
                  className="token-btn"
                  onClick={() => handlePuzzlePick(item)}
                  disabled={stage > 0 || isSyncing}
                >
                  <span>{item}</span>
                </button>
              ))}
            </div>

            <div className="sequence-panel">
              <div>
                <span>Secilenler</span>
                <strong>{(responses.puzzle || []).length ? responses.puzzle.join(' > ') : 'Henuz bos'}</strong>
              </div>
              <button className="ghost-btn" onClick={resetPuzzle} disabled={isSyncing}>
                Tekrar dene
              </button>
            </div>
          </article>

          <article className={stage > 0 ? 'stage-card stage-card--active' : 'stage-card stage-card--locked'}>
            <div className="card-heading">
              <span>02</span>
              <div>
                <h2>Tarzini sec</h2>
                <p>Mini sorularla bizim bulusma frekansimizi okuyalim.</p>
              </div>
            </div>

            {stage === 0 && <p className="locked-copy">Once kapsulu acman gerekiyor.</p>}

            {stage > 0 && (
              <div className="question-stack">
                {questionDeck.map((item) => (
                  <div key={item.id} className="question-card">
                    <h3>{item.prompt}</h3>
                    <div className="option-grid">
                      {item.options.map((option) => (
                        <button
                          key={option}
                          className={responses[item.id] === option ? 'option-btn option-btn--active' : 'option-btn'}
                          onClick={() => answerQuestion(item.id, option)}
                          disabled={isSyncing}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className={stage > 0 ? 'stage-card' : 'stage-card stage-card--locked'}>
            <div className="card-heading">
              <span>03</span>
              <div>
                <h2>Kucuk bir not</h2>
                <p>Birlikte yasamak istedigin en minik sahneyi yaz.</p>
              </div>
            </div>

            <form className="memory-form" onSubmit={submitClue}>
              <textarea
                placeholder="Mesela: yagmurda ayni semsiyeye sigisip kahve almamiz..."
                value={typedClue}
                onChange={(event) => setTypedClue(event.target.value)}
              />
              <button className="primary-btn" type="submit" disabled={isSyncing}>
                Hafizaya ekle
              </button>
            </form>
          </article>

          <article className={allAnswered ? 'stage-card final-card' : 'stage-card stage-card--locked'}>
            <div className="card-heading">
              <span>04</span>
              <div>
                <h2>Asil soru</h2>
                <p>Butun oyun aslinda bunun icindi.</p>
              </div>
            </div>

            <div className="proposal-box">
              <p>
                Benimle cikmak ister misin? Bu kez ekranda degil, gercekte, kahve ve gulme
                payi da icinde.
              </p>
              <div className="cta-row">
                <button className="primary-btn" onClick={() => chooseFinal('yes')} disabled={isSyncing}>
                  Evet, isterim
                </button>
                <button className="ghost-btn" onClick={() => chooseFinal('thinking')} disabled={isSyncing}>
                  Biraz daha dusuneyim
                </button>
              </div>
              {responses.finalAnswer && (
                <div className="answer-badge">
                  Son cevap: {responses.finalAnswer === 'yes' ? 'Kabul edildi' : 'Dusunuyor'}
                </div>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

export default App;
