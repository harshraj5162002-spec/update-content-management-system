import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, BarChart3, Bell, BookOpen, Bookmark, CheckCircle2, Clock3, Compass, FileText, Heart, History, LayoutDashboard, LogIn, LogOut, Menu, PenLine, Search, Settings, ShieldCheck, Sparkles, Tags, TrendingUp, Users, WandSparkles, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('cms-token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.errors?.[0]?.msg || 'Request failed');
  }

  return response.json();
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('cms-token') || '');
  const [user, setUser] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (token) {
      localStorage.setItem('cms-token', token);
    } else {
      localStorage.removeItem('cms-token');
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      return undefined;
    }
    apiRequest('/auth/me')
      .then((payload) => {
        if (!cancelled) setUser(payload.user);
      })
      .catch(() => {
        if (!cancelled) {
          setToken('');
          setUser(null);
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  function handleLogout() {
    setToken('');
    setUser(null);
    navigate('/');
  }

  const isAuthPage = ['/auth', '/forgot-password', '/reset-password'].includes(location.pathname);
  const readerLinks = [
    { to: '/', label: 'Home', icon: LayoutDashboard },
    ...(token ? [{ to: '/for-you', label: 'For you', icon: Sparkles }] : []),
    { to: '/trending', label: 'Trending', icon: TrendingUp },
    { to: '/explore', label: 'Explore', icon: Compass },
    { to: '/categories', label: 'Categories', icon: Tags },
    { to: '/authors', label: 'Authors', icon: Users },
    ...(token ? [
      { to: '/saved', label: 'Saved articles', icon: Bookmark },
      { to: '/history', label: 'Reading history', icon: History },
    ] : []),
  ];
  const workspaceLinks = user?.role === 'admin'
    ? [
      { to: '/admin', label: 'Admin overview', icon: ShieldCheck },
      { to: '/admin/review', label: 'Review queue', icon: CheckCircle2 },
      { to: '/admin/articles', label: 'Article management', icon: FileText },
      { to: '/admin/users', label: 'User management', icon: Users },
      { to: '/admin/categories', label: 'Categories & tags', icon: Tags },
      { to: '/admin/reports', label: 'Reports & appeals', icon: Bell },
      { to: '/admin/abuse', label: 'Spam & abuse', icon: ShieldCheck },
      { to: '/admin/audit', label: 'Audit history', icon: Activity },
      { to: '/admin/settings', label: 'System settings', icon: Settings },
    ]
    : ['author', 'admin'].includes(user?.role)
      ? [
        { to: '/author', label: 'Author overview', icon: BarChart3 },
        { to: '/author/articles', label: 'My articles', icon: FileText },
        { to: '/author/new', label: 'Write an article', icon: PenLine },
        { to: '/author/analytics', label: 'Analytics', icon: Activity },
        { to: '/author/freshness', label: 'Freshness alerts', icon: Clock3 },
      ]
      : [];
  const utilityLinks = [
    { to: '/ai-tools', label: 'AI tools', icon: WandSparkles },
    ...(token ? [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/settings', label: 'Settings', icon: Settings },
    ] : []),
  ];

  return (
    <div className={`app-shell${isAuthPage ? ' auth-shell' : ''}`}>
      {!isAuthPage && (
        <aside className={`app-sidebar${mobileMenuOpen ? ' open' : ''}`}>
          <Link to="/" className="brand-wrap sidebar-brand" onClick={() => setMobileMenuOpen(false)}>
            <div className="brand-mark">S</div>
            <div><div className="brand-name">Signal CMS</div><div className="brand-subtitle">Editorial intelligence</div></div>
          </Link>
          <nav className="sidebar-nav" aria-label="Workspace navigation">
            <span className="nav-section-label">DISCOVER</span>
            {readerLinks.map((item) => <SidebarLink key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />)}
            {workspaceLinks.length > 0 && <><span className="nav-section-label">WORKSPACE</span>{workspaceLinks.map((item) => <SidebarLink key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />)}</>}
            <span className="nav-section-label">TOOLS</span>
            {utilityLinks.map((item) => <SidebarLink key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />)}
          </nav>
          <div className="sidebar-promo">
            <Sparkles size={17} />
            <strong>Make every story count</strong>
            <span>Explore AI-powered editorial tools.</span>
            <Link to="/ai-tools" className="text-link">Explore tools</Link>
          </div>
        </aside>
      )}

      <div className="workspace-main">
        <header className="topbar">
          <button type="button" className="mobile-menu-button ghost-button" aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          {!isAuthPage && (
            <form className="global-search" onSubmit={(event) => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(searchQuery)}`); }}>
              <Search size={17} aria-hidden="true" />
              <input aria-label="Search articles" placeholder="Search stories, topics, authors..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <button type="submit" aria-label="Submit search"><Search size={16} /></button>
            </form>
          )}
          <div className="topbar-actions">
            {token && <Link to="/notifications" className="ghost-button notification-link" aria-label="Notifications"><Bell size={17} /></Link>}
            {token ? (
              <div className="profile-menu">
                <Link to="/settings" className="profile-chip">
                  <span className="avatar-circle">{(user?.name || 'U').slice(0, 1).toUpperCase()}</span>
                  <span className="profile-identity"><strong>{user?.name || 'Account'}</strong><small>{user?.role || 'Member'}</small></span>
                </Link>
                <button type="button" className="ghost-button logout-button" onClick={handleLogout} aria-label="Logout"><LogOut size={16} /></button>
              </div>
            ) : (
              <Link to="/auth" className="primary-button"><LogIn size={16} />Login</Link>
            )}
          </div>
        </header>

        <Routes>
          <Route path="/" element={<HomePage user={user} />} />
          <Route path="/auth" element={<AuthPage onLogin={setToken} />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/article/:id" element={<ArticlePage token={token} />} />
          <Route path="/for-you" element={<ArticleCollectionPage title="For you" endpoint="/recommendations" authenticated />} />
          <Route path="/trending" element={<ArticleCollectionPage title="Trending now" endpoint="/trending" />} />
          <Route path="/explore" element={<SearchPage />} />
          <Route path="/search" element={<SearchPage key={location.search} />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/categories/:id" element={<SearchPage key={location.pathname} />} />
          <Route path="/authors" element={<AuthorsPage />} />
          <Route path="/authors/:id" element={<AuthorProfilePage />} />
          <Route path="/saved" element={<ArticleCollectionPage title="Saved articles" endpoint="/me/bookmarks" authenticated />} />
          <Route path="/history" element={<ArticleCollectionPage title="Reading history" endpoint="/me/history" authenticated />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage user={user} />} />
          <Route path="/author" element={<AuthorDashboardPage user={user} />} />
          <Route path="/author/articles" element={<AuthorArticlesPage user={user} />} />
          <Route path="/author/new" element={<ArticleEditorPage user={user} token={token} />} />
          <Route path="/author/edit/:id" element={<ArticleEditorPage user={user} token={token} />} />
          <Route path="/author/analytics" element={<AuthorAnalyticsPage user={user} />} />
          <Route path="/author/freshness" element={<FreshnessPage />} />
          <Route path="/ai-tools" element={<AIToolsPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/review" element={<ReviewQueuePage />} />
          <Route path="/admin/articles" element={<AdminArticlesPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/categories" element={<AdminTaxonomyPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/abuse" element={<AdminAbusePage />} />
          <Route path="/admin/audit" element={<AuditPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </div>
  );
}

function SidebarLink({ item, onNavigate }) {
  const Icon = item.icon;
  return <NavLink to={item.to} end={item.to === '/'} onClick={onNavigate} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}><Icon size={17} /><span>{item.label}</span></NavLink>;
}

function HomePage({ user }) {
  const [home, setHome] = useState(null);
  const [readingInsights, setReadingInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadHome() {
      try {
        const data = await apiRequest('/articles/home');
        setHome(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadHome();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    apiRequest('/me/reading-insights')
      .then(setReadingInsights)
      .catch((insightsError) => setError(insightsError.message));
  }, [user?.id]);

  if (loading) return <div className="page-panel">Loading editorial home…</div>;
  if (error) return <div className="page-panel error-panel">Unable to load home: {error}</div>;

  return (
    <main className="content-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">AI-Powered editorial engine</span>
          <h1>Good stories deserve a thoughtful home.</h1>
          <p>
            Write, review, and share useful work with a clear editorial process from first draft to publication.
          </p>
          <div className="hero-actions">
            {!user && <Link to="/auth" className="primary-button">Create an account</Link>}
            <Link to={home?.featured?.[0] ? `/article/${home.featured[0].id}` : '/explore'} className="secondary-button">Explore stories</Link>
          </div>

          <div className="mini-stats">
            <div>
              <strong>{(home?.trending || []).length}</strong>
              <span>stories trending</span>
            </div>
            <div>
              <strong>{home?.categories?.length || 0}</strong>
              <span>editorial categories</span>
            </div>
            <div>
              <strong>{user ? 'Personalized' : 'Open'}</strong>
              <span>reader discovery</span>
            </div>
          </div>
        </div>

        {home?.featured?.[0] && <Link className="hero-preview featured-preview" to={`/article/${home.featured[0].id}`}>
          {home.featured[0].coverImage && <img src={home.featured[0].coverImage} alt="" />}
          <div className="featured-preview-copy">
            <span className="eyebrow">A story to start with</span>
            <h2>{home.featured[0].title}</h2>
            <p>{home.featured[0].summary}</p>
            <span className="text-link">Read the story</span>
          </div>
        </Link>}
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">Featured</span>
            <h2>Editorial picks</h2>
          </div>
          <Link to="/explore" className="text-link">Browse all stories</Link>
        </div>

        <div className="card-grid three-up">
          {(home?.featured || []).map((article) => (
            <article className="story-card" key={article.id}>
              <img src={article.coverImage} alt={article.title} />
              <div className="story-body">
                <span className="badge">{article.tags?.[0] || 'Article'}</span>
                <h3>{article.title}</h3>
                <p>{article.summary}</p>
                <Link to={`/article/${article.id}`} className="text-link">Read article</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="two-column-layout">
        <div className="section-card">
          <div className="section-header">
            <div>
              <span className="eyebrow">Trending</span>
              <h2>Most active stories</h2>
            </div>
          </div>
          <div className="list-stack">
            {(home?.trending || []).map((article, idx) => (
              <div key={article.id} className="rank-row">
                <span className="rank-pill">#{idx + 1}</span>
                <div>
                  <strong>{article.title}</strong>
                  <small>{article.views.toLocaleString()} views</small>
                </div>
                <span className="score-tag">{article.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">
            <div>
              <span className="eyebrow">For you</span>
              <h2>Recommended reading</h2>
            </div>
          </div>
          <div className="list-stack compact-list">
            {(home?.recommendations || []).map((article) => (
              <div key={article.id} className="mini-card">
                <div>
                  <strong>{article.title}</strong>
                  <small>{article.summary}</small>
                </div>
                <Link to={`/article/${article.id}`} className="text-link">Open</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">Signals</span>
            <h2>Trending categories</h2>
          </div>
        </div>
        <div className="tag-grid">
          {(home?.topics?.categories || []).map((category) => (
            <span key={category.name} className="category-pill">{category.name}</span>
          ))}
        </div>
      </section>

      <section className="dashboard-three-up">
        <div className="section-card">
          <div className="section-header">
            <div><span className="eyebrow">Signals</span><h2>Trending topics</h2></div>
          </div>
          <div className="topic-list">
            {(home?.topics?.keywords || []).slice(0, 6).map((topic, index) => (
              <Link key={topic.name} to={`/search?q=${encodeURIComponent(topic.name)}`} className="topic-row">
                <span className="rank-pill">#{index + 1}</span><span>{topic.name}</span><small>{topic.count} stories</small>
              </Link>
            ))}
          </div>
          <p className="muted-copy">Measured from published stories in the last 30 days.</p>
        </div>
        <div className="section-card reading-insights">
          <div className="section-header">
            <div><span className="eyebrow">Reading insights</span><h2>Your reading, at a glance</h2></div>
          </div>
          {user ? (
            <>
              <div className="reading-metrics">
                <div><strong>{readingInsights?.articlesRead || 0}</strong><span>stories read</span></div>
                <div><strong>{readingInsights?.completed || 0}</strong><span>completed</span></div>
                <div><strong>{readingInsights?.estimatedMinutes || 0}</strong><span>est. minutes</span></div>
              </div>
              <div className="reading-chart" aria-label="Reading activity over the last seven days">
                {(readingInsights?.timeline || []).map((day) => {
                  const maximum = Math.max(1, ...(readingInsights?.timeline || []).map((item) => item.reads));
                  return <div className="reading-chart-day" key={day.date} title={`${day.reads} reads`}><span style={{ height: `${Math.max(6, day.reads / maximum * 100)}%` }} /><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small></div>;
                })}
              </div>
            </>
          ) : (
            <div className="insight-card"><Sparkles size={20} /><div><strong>Recommendations get smarter</strong><span>Sign in and choose your interests to personalize your For You feed.</span></div></div>
          )}
          <Link to={user ? '/settings' : '/auth'} className="text-link">{user ? 'Set your interests' : 'Create a reader profile'}</Link>
        </div>
        <div className="section-card ai-assistant-card">
          <div className="section-header">
            <div><span className="eyebrow">AI studio</span><h2>Write with a clearer signal</h2></div>
          </div>
          <p className="muted-copy">Summaries, content-quality checks, topic suggestions and moderation analysis—available with the local deterministic engine.</p>
          <Link to="/ai-tools" className="primary-button"><WandSparkles size={16} />Open AI tools</Link>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div><span className="eyebrow">Discover</span><h2>Explore categories</h2></div>
          <Link to="/categories" className="text-link">All categories</Link>
        </div>
        <div className="category-card-grid">
          {(home?.categories || []).map((category) => (
            <Link key={category.id} to={`/categories/${category.id}`} className="category-card">
              <span>{category.name}</span><small>{category.description}</small>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function ArticlePage({ token }) {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [readProgress, setReadProgress] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState([]);
  const [quizResult, setQuizResult] = useState(null);
  const [quizError, setQuizError] = useState('');
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  useEffect(() => {
    async function loadArticle() {
      try {
        setQuizAnswers([]);
        setQuizResult(null);
        setQuizError('');
        const data = await apiRequest(`/articles/${id}`);
        setArticle(data);
        const commentData = await apiRequest(`/articles/${id}/comments`);
        setComments(commentData.items || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadArticle();
  }, [id]);

  async function submitQuiz(event) {
    event.preventDefault();
    setQuizSubmitting(true);
    setQuizError('');
    try {
      const result = await apiRequest(`/articles/${id}/quiz/attempt`, {
        method: 'POST',
        body: JSON.stringify({ answers: quizAnswers }),
      });
      setQuizResult(result);
    } catch (submitError) {
      setQuizError(submitError.message);
    } finally {
      setQuizSubmitting(false);
    }
  }

  useEffect(() => {
    if (!token || !article) return undefined;
    let lastSent = -1;
    const updateProgress = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable <= 0 ? 100 : Math.min(100, Math.floor((window.scrollY / scrollable) * 100));
      setReadProgress(progress);
      if (progress >= lastSent + 10) {
        lastSent = progress;
        apiRequest(`/me/history/${id}`, { method: 'PATCH', body: JSON.stringify({ progress }) })
          .catch((progressError) => setActionMessage(progressError.message));
      }
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
    return () => window.removeEventListener('scroll', updateProgress);
  }, [article, id, token]);

  async function engage(type) {
    try {
      const result = await apiRequest(`/articles/${id}/engagement`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      setArticle((current) => ({ ...current, ...result.article }));
      setActionMessage(result.active ? `${type} saved.` : `${type} removed.`);
    } catch (actionError) {
      setActionMessage(actionError.message);
    }
  }

  async function addComment(event) {
    event.preventDefault();
    try {
      const result = await apiRequest(`/articles/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody }) });
      if (result.comment.status === 'published') setComments((current) => [...current, result.comment]);
      setCommentBody('');
      setActionMessage(result.comment.status === 'published' ? 'Comment posted.' : 'Comment submitted for moderation.');
    } catch (commentError) { setActionMessage(commentError.message); }
  }

  async function reportArticle() {
    const reason = window.prompt('Why are you reporting this article?');
    if (!reason) return;
    try {
      await apiRequest('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'article', targetId: id, reason }) });
      setActionMessage('Report sent to the moderation team.');
    } catch (reportError) { setActionMessage(reportError.message); }
  }

  async function regenerateSummary() {
    try {
      const result = await apiRequest('/ai/tools/summary', { method: 'POST', body: JSON.stringify({ articleId: id, regenerate: true }) });
      setArticle((current) => ({ ...current, aiInsights: result.result }));
      setActionMessage('Article summary refreshed.');
    } catch (summaryError) { setActionMessage(summaryError.message); }
  }

  if (loading) return <div className="page-panel">Loading article…</div>;
  if (error) return <div className="page-panel error-panel">{error}</div>;
  if (!article) return <div className="page-panel">Article unavailable.</div>;

  return (
    <main className="article-page">
      <div className="article-header-panel">
        <div className="article-breadcrumbs">Stories / {article.categoryIds?.join(' / ') || 'General'}</div>
        <h1>{article.title}</h1>
        <p className="article-summary">{article.summary}</p>
        <div className="article-meta">
          <span>By {article.author?.name || 'Staff writer'}</span>
          <span>•</span>
          <span>{new Date(article.publishedAt || article.createdAt).toLocaleDateString()}</span>
          <span>•</span>
          <span>{article.tags?.join(' · ')}</span>
        </div>
      </div>

      <div className="article-image-wrap">
        <img src={article.coverImage} alt={article.title} />
      </div>

      <div className="article-content-grid">
        <article className="article-body-panel">
          <div className="reading-progress">
            <span style={{ width: `${readProgress}%` }} />
          </div>
          <p>{article.content}</p>
          {article.quiz?.questions?.length > 0 && (
            <section className="article-quiz section-card">
              <h2>Quick knowledge check</h2>
              <p className="muted-copy">Choose one answer for each question to see your score.</p>
              <form onSubmit={submitQuiz}>
                {article.quiz.questions.map((question, questionIndex) => (
                  <fieldset className="quiz-question" key={`${question.prompt}-${questionIndex}`}>
                    <legend>{questionIndex + 1}. {question.prompt}</legend>
                    {question.options.map((option, optionIndex) => (
                      <label className="quiz-option" key={`${option}-${optionIndex}`}>
                        <input
                          type="radio"
                          name={`quiz-${id}-${questionIndex}`}
                          value={optionIndex}
                          checked={quizAnswers[questionIndex] === optionIndex}
                          onChange={() => {
                            setQuizAnswers((current) => {
                              const next = [...current];
                              next[questionIndex] = optionIndex;
                              return next;
                            });
                            setQuizResult(null);
                          }}
                          required
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
                <button className="primary-button" type="submit" disabled={quizSubmitting}>
                  {quizSubmitting ? 'Checking answers…' : 'Submit quiz'}
                </button>
              </form>
              {quizError && <p className="error-panel inline-error" role="alert">{quizError}</p>}
              {quizResult && (
                <div className="quiz-result" role="status">
                  <h3>Your score: {quizResult.score} / {quizResult.total}</h3>
                  <ul>
                    {quizResult.results.map((result, questionIndex) => (
                      <li key={questionIndex}>
                        {result.isCorrect ? 'Correct' : `Correct answer: ${article.quiz.questions[questionIndex].options[result.correctOptionIndex]}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
          <div className="takeaway-box">
            <h3>AI summary</h3>
            <p>{article.aiInsights?.summary}</p>
            <ul>
              {(article.aiInsights?.keyTakeaways || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {token && <button type="button" className="secondary-button" onClick={regenerateSummary}><Sparkles size={15} />Regenerate summary</button>}
          </div>
          <section className="comments-section">
            <h2>Discussion <span className="muted-copy">({comments.length})</span></h2>
            {comments.map((comment) => <article className="comment-card" key={comment.id}><p>{comment.body}</p><small>{comment.author?.name || 'Reader'} · {new Date(comment.createdAt).toLocaleDateString()}</small></article>)}
            {token ? <form className="comment-form" onSubmit={addComment}><label htmlFor="comment-body">Add a comment</label><textarea id="comment-body" value={commentBody} required minLength={2} maxLength={5000} onChange={(event) => setCommentBody(event.target.value)} /><button className="primary-button" type="submit">Post comment</button></form> : <Link to="/auth" className="text-link">Sign in to join the discussion</Link>}
            {token && <button type="button" className="report-button" onClick={reportArticle}>Report this article</button>}
          </section>
        </article>

        <aside className="sidebar-panel">
          <div className="stat-card">
            <BookOpen size={18} />
            <div>
              <strong>{article.views?.toLocaleString() || 0}</strong>
              <span>reads</span>
            </div>
          </div>
          <div className="stat-card">
            <Sparkles size={18} />
            <div>
              <strong>{article.moderation?.riskScore || 12}</strong>
              <span>risk score</span>
            </div>
          </div>
          <div className="stat-card">
            <TrendingUp size={18} />
            <div>
              <strong>{article.likes || 0}</strong>
              <span>likes</span>
            </div>
          </div>
          <div className="note-card">
            <h4>Suggested improvements</h4>
            {article.suggestions?.length ? (
              <ul>
                {article.suggestions.slice(0, 3).map((item) => (
                  <li key={`${item.type}-${item.value}`}>{item.type}: {typeof item.value === 'string' ? item.value : item.value.join(', ')}</li>
                ))}
              </ul>
            ) : (
              <p>No suggestions required.</p>
            )}
          </div>
          <div className="article-action-group">
            <button type="button" className="secondary-button" onClick={() => engage('like')} disabled={!token}><Heart size={16} />Like</button>
            <button type="button" className="secondary-button" onClick={() => engage('bookmark')} disabled={!token}><Bookmark size={16} />Save</button>
            <button type="button" className="secondary-button" onClick={() => engage('share')} disabled={!token}><Users size={16} />Share</button>
            {actionMessage && <p className="muted-copy" role="status">{actionMessage}</p>}
            {!token && <Link to="/auth" className="text-link">Sign in to engage</Link>}
          </div>
        </aside>
      </div>

      {article.related?.length > 0 && (
        <section className="section-card">
          <div className="section-header"><div><span className="eyebrow">Continue reading</span><h2>Related articles</h2></div></div>
          <div className="card-grid three-up">
            {article.related.map((related) => (
              <article className="story-card related-story" key={related.id}>
                <div className="story-body">
                  <span className="badge">{related.relatedReasons?.join(' · ') || 'Related'}</span>
                  <h3>{related.title}</h3><p>{related.summary}</p>
                  <Link to={`/article/${related.id}`} className="text-link">Read article</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function AuthPage({ onLogin }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: 'author@signalcms.dev', password: 'AuthorPass123!', role: 'reader' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = mode === 'login'
        ? await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }) })
        : await apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ name: form.name, email: form.email, password: form.password, role: form.role }) });

      onLogin(payload.token);
      navigate(payload.user?.role === 'reader' ? '/for-you' : '/author');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel auth-visual">
        <div className="auth-badge">AI editorial operations</div>
        <h1>Turn content strategy into a measurable growth engine.</h1>
        <p>Build, moderate, and optimize every article with clear workflows, signals, and AI assistance.</p>
      </section>

      <section className="auth-panel auth-form-panel">
        <div className="auth-toggle">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => {
            setMode('login');
            setForm((current) => ({ ...current, email: current.email || 'author@signalcms.dev', password: current.password || 'AuthorPass123!' }));
          }}>Login</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => {
            setMode('signup');
            setForm((current) => ({ ...current, email: '', password: '' }));
          }}>Signup</button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <label>
              Full name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
            </label>
          )}

          {mode === 'signup' && (
            <label>
              Account type
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="reader">Reader</option>
                <option value="author">Author</option>
              </select>
            </label>
          )}

          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required autoComplete="email" />
          </label>

          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>

          {error && <div className="error-panel inline-error">{error}</div>}

          <button type="submit" className="primary-button full-width" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
          {mode === 'login' && <Link className="text-link" to="/forgot-password">Forgot password?</Link>}
        </form>

        <div className="demo-note">
          Demo access: admin@signalcms.dev / AdminPass123!<br />
          author@signalcms.dev / AuthorPass123!
        </div>
      </section>
    </main>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestReset(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await apiRequest('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-layout"><section className="auth-panel auth-form-panel">
    <span className="eyebrow">Account recovery</span>
    <h1>Forgot your password?</h1>
    <p className="muted-copy">Enter your account email. If it is registered, we’ll send a secure reset link.</p>
    <form className="auth-form" onSubmit={requestReset}>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
      {error && <div className="error-panel inline-error" role="alert">{error}</div>}
      {message && <p className="success-message" role="status">{message}</p>}
      <button className="primary-button full-width" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
      <Link className="text-link" to="/auth">Back to login</Link>
    </form>
  </section></main>;
}

function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const resetToken = new URLSearchParams(location.search).get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function resetPassword(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password }),
      });
      setMessage(result.message);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-layout"><section className="auth-panel auth-form-panel">
    <span className="eyebrow">Account recovery</span>
    <h1>Set a new password</h1>
    {resetToken ? <form className="auth-form" onSubmit={resetPassword}>
      <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
      <label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>
      {error && <div className="error-panel inline-error" role="alert">{error}</div>}
      {message && <p className="success-message" role="status">{message}</p>}
      {message ? <button className="primary-button full-width" type="button" onClick={() => navigate('/auth')}>Go to login</button> : <button className="primary-button full-width" type="submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>}
    </form> : <div className="error-panel inline-error" role="alert">This reset link is missing or invalid. Request a new one to continue.</div>}
    <Link className="text-link" to="/forgot-password">Request another reset link</Link>
  </section></main>;
}

function AuthorDashboardPage({ user }) {
  const [articles, setArticles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    async function loadAuthorDashboard() {
      try {
        const [articleData, analytics] = await Promise.all([
          apiRequest(`/articles?authorId=${encodeURIComponent(user.id)}&limit=50`),
          apiRequest('/me/analytics?days=30'),
        ]);
        if (!cancelled) {
          setArticles(articleData.items || []);
          setStats(analytics.stats);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAuthorDashboard();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!user) return <AccessNotice message="Sign in with an author or admin account to open the author workspace." />;
  if (loading) return <div className="page-panel">Loading author workspace…</div>;

  return (
    <main className="page-content">
      <PageHeading eyebrow="Author workspace" title="Performance overview" description="A live view of your published work and editorial pipeline." action={<Link to="/author/new" className="primary-button"><PenLine size={16} />Write article</Link>} />
      {error && <div className="page-panel error-panel">{error}</div>}
      <section className="section-card">
        <div className="stats-grid">
          <div className="stat-box"><span>Views (30 days)</span><strong>{(stats?.views || 0).toLocaleString()}</strong></div>
          <div className="stat-box"><span>Engagement rate</span><strong>{stats?.engagementRate || 0}%</strong></div>
          <div className="stat-box"><span>Drafts</span><strong>{articles.filter((item) => item.status === 'draft').length}</strong></div>
          <div className="stat-box"><span>Published</span><strong>{stats?.publishedArticles || 0}</strong></div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div><span className="eyebrow">Content</span><h2>Recent articles</h2></div>
          <Link to="/author/articles" className="text-link">Manage all</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {articles.slice(0, 8).map((article) => (
                <tr key={article.id}>
                  <td>{article.title}</td>
                  <td><span className="status-badge">{article.status}</span></td>
                  <td>{article.moderation?.riskScore ?? '—'}</td>
                  <td><Link to={article.status === 'published' ? `/article/${article.id}` : `/author/edit/${article.id}`} className="text-link">{article.status === 'published' ? 'Open' : 'Edit'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!articles.length && <div className="empty-state">Create a draft to get started.</div>}
        </div>
      </section>
    </main>
  );
}

function AdminDashboardPage() {
  const [moderation, setModeration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAdminData() {
      try {
        const data = await apiRequest('/moderation/dashboard');
        setModeration(data);
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    }

    loadAdminData();
  }, []);

  if (loading) return <div className="page-panel">Loading moderation dashboard…</div>;

  return (
    <main className="page-content">
      <PageHeading eyebrow="Trust & safety" title="Admin overview" description="Moderation decisions, community reports, appeals and abuse signals." action={<Link to="/admin/review" className="primary-button"><ShieldCheck size={16} />Review queue</Link>} />
      {error && <div className="page-panel error-panel">{error}</div>}
      <section className="section-card">
        <div className="stats-grid">
          <div className="stat-box"><span>Approved</span><strong>{moderation?.overview?.approved || 0}</strong></div>
          <div className="stat-box"><span>Review</span><strong>{moderation?.overview?.review || 0}</strong></div>
          <div className="stat-box"><span>Blocked</span><strong>{moderation?.overview?.blocked || 0}</strong></div>
          <div className="stat-box"><span>Open reports</span><strong>{moderation?.overview?.openReports || 0}</strong></div>
          <div className="stat-box"><span>Open appeals</span><strong>{moderation?.overview?.openAppeals || 0}</strong></div>
          <div className="stat-box"><span>Abuse alerts (7 days)</span><strong>{moderation?.overview?.recentAbuse || 0}</strong></div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">Measured trends</span>
            <h2>Topics & risk signals</h2>
          </div>
        </div>
        <div className="tag-grid">
          {(moderation?.topics || []).map((topic) => (
            <span key={topic.name} className="category-pill">{topic.name} · {topic.count}</span>
          ))}
        </div>
        <p className="muted-copy">Risk scores prioritize review: low-risk submissions still require administrator approval, while higher-risk content may be quarantined for closer review.</p>
      </section>
    </main>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action}
    </div>
  );
}

function AccessNotice({ message = 'Sign in to access this workspace.' }) {
  return <main className="section-card access-notice"><h2>Sign in required</h2><p className="muted-copy">{message}</p><Link to="/auth" className="primary-button"><LogIn size={16} />Sign in</Link></main>;
}

function ArticleCollectionPage({ title, endpoint, authenticated = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (authenticated && !localStorage.getItem('cms-token')) {
      return undefined;
    }
    let cancelled = false;
    apiRequest(endpoint).then((payload) => {
      if (cancelled) return;
      const values = payload.items || [];
      setItems(endpoint === '/me/history' ? values.map((entry) => entry.article).filter(Boolean) : values);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [endpoint, authenticated]);

  if (authenticated && !localStorage.getItem('cms-token')) return <AccessNotice />;
  if (loading) return <main className="page-panel">Loading {title.toLowerCase()}…</main>;
  if (error) return <main className="page-panel error-panel">{error}</main>;

  return (
    <main className="page-content">
      <PageHeading eyebrow="Discovery" title={title} description="Published stories ranked using measured engagement and reader interests." />
      {items.length ? (
        <div className="card-grid three-up">
          {items.map((article) => (
            <article className="story-card" key={article.id}>
              {article.coverImage && <img src={article.coverImage} alt="" loading="lazy" />}
              <div className="story-body">
                <span className="badge">{article.tags?.[0] || article.categoryIds?.[0] || 'Editorial'}</span>
                <h3><Link to={`/article/${article.id}`}>{article.title}</Link></h3>
                <p>{article.summary}</p>
                {article.recommendationReasons?.map((reason) => <small className="reason-line" key={reason}>{reason}</small>)}
                {article.trendingReasons?.map((reason) => <small className="reason-line" key={reason}>{reason}</small>)}
                {endpoint === '/recommendations' && (
                  <div className="feedback-row">
                    <button type="button" className="secondary-button" onClick={async () => {
                      try {
                        await apiRequest('/recommendations/feedback', { method: 'POST', body: JSON.stringify({ articleId: article.id, helpful: true }) });
                        setFeedback('Thanks — your recommendation feedback was saved.');
                      } catch (feedbackError) { setFeedback(feedbackError.message); }
                    }}>Helpful</button>
                    <button type="button" className="secondary-button" onClick={async () => {
                      try {
                        await apiRequest('/recommendations/feedback', { method: 'POST', body: JSON.stringify({ articleId: article.id, helpful: false }) });
                        setFeedback('Feedback saved.');
                      } catch (feedbackError) { setFeedback(feedbackError.message); }
                    }}>Not for me</button>
                  </div>
                )}
                <Link to={`/article/${article.id}`} className="text-link">Read story</Link>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><BookOpen size={24} /><h2>Nothing here yet</h2><p>Published articles will appear here as they become available.</p><Link to="/explore" className="text-link">Explore stories</Link></div>}
      {feedback && <p className="feedback-message" role="status">{feedback}</p>}
    </main>
  );
}

function SearchPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const categoryId = location.pathname.startsWith('/categories/') ? location.pathname.split('/').pop() : '';
  const query = params.get('q') || '';
  const [search, setSearch] = useState(query);
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [sort, setSort] = useState(params.get('sort') || 'relevance');
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const requestKey = `${query}|${categoryId}|${sort}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    const queryParams = new URLSearchParams({ q: query, sort });
    if (categoryId) queryParams.set('categoryId', categoryId);
    apiRequest(`/search?${queryParams}`).then((payload) => {
      if (!cancelled) {
        setItems(payload.items || []);
        setSuggestions(payload.suggestions || []);
        setError('');
      }
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message);
    }).finally(() => {
      if (!cancelled) setLoadedKey(requestKey);
    });
    return () => { cancelled = true; };
  }, [query, categoryId, sort, requestKey]);

  const navigate = useNavigate();
  return (
    <main className="page-content">
      <PageHeading eyebrow={categoryId ? 'Category' : 'Search'} title={categoryId ? categoryId.replaceAll('-', ' ') : 'Explore stories'} description="Search published titles, full text, topics and categories." />
      <form className="search-toolbar" onSubmit={(event) => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(search)}`); }}>
        <label className="sr-only" htmlFor="story-search">Search stories</label>
        <input id="story-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stories, topics, categories…" />
        <label className="sort-select">Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="relevance">Relevance</option><option value="newest">Newest</option><option value="popular">Most read</option>
          </select>
        </label>
        <button type="submit" className="primary-button"><Search size={16} />Search</button>
      </form>
      {loading ? <div className="page-panel">Searching published stories…</div> : error ? <div className="page-panel error-panel">{error}</div> : items.length ? (
        <div className="card-grid three-up">
          {items.map((article) => <article className="story-card" key={article.id}>
            {article.coverImage && <img src={article.coverImage} alt="" loading="lazy" />}
            <div className="story-body"><span className="badge">{article.tags?.[0] || 'Editorial'}</span><h3><Link to={`/article/${article.id}`}>{article.title}</Link></h3><p>{article.summary}</p><Link to={`/article/${article.id}`} className="text-link">Read story</Link></div>
          </article>)}
        </div>
      ) : <div className="empty-state"><Search size={24} /><h2>No matching stories</h2><p>Try another phrase or remove a filter.</p></div>}
      {!loading && !error && !items.length && suggestions.length > 0 && <div className="tag-grid search-suggestions">{suggestions.map((suggestion) => <Link key={suggestion} className="category-pill" to={`/search?q=${encodeURIComponent(suggestion)}`}>{suggestion}</Link>)}</div>}
    </main>
  );
}

function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest('/categories').then(setCategories).catch((loadError) => setError(loadError.message)); }, []);
  return <main className="page-content"><PageHeading eyebrow="Explore" title="Categories" description="Browse stories by editorial topic." />
    {error ? <div className="page-panel error-panel">{error}</div> : <div className="category-card-grid">{categories.map((category) => <Link to={`/categories/${category.id}`} className="category-card" key={category.id}><span>{category.name}</span><small>{category.description}</small><small>{category.articleCount} published stories</small></Link>)}</div>}
  </main>;
}

function AuthorsPage() {
  const [authors, setAuthors] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest('/authors').then(setAuthors).catch((loadError) => setError(loadError.message)); }, []);
  return <main className="page-content"><PageHeading eyebrow="Community" title="Authors" description="Meet the writers contributing to Signal CMS." />
    {error ? <div className="page-panel error-panel">{error}</div> : <div className="author-card-grid">{authors.map((author) => <Link className="author-card" to={`/authors/${author.id}`} key={author.id}><span className="avatar-circle large-avatar">{author.avatar || author.name?.slice(0, 1)}</span><div><strong>{author.name}</strong><small>{author.role}</small><small>{author.stats?.publishedArticles || 0} published articles</small></div></Link>)}</div>}
  </main>;
}

function AuthorProfilePage() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest(`/authors/${id}`).then(setProfile).catch((loadError) => setError(loadError.message)); }, [id]);
  if (error) return <main className="page-panel error-panel">{error}</main>;
  if (!profile) return <main className="page-panel">Loading author profile…</main>;
  return <main className="page-content"><PageHeading eyebrow="Author profile" title={profile.author.name} description={profile.author.bio || 'Signal CMS contributor'} />
    <section className="stats-grid"><div className="stat-box"><span>Published articles</span><strong>{profile.stats.publishedArticles}</strong></div><div className="stat-box"><span>Reads</span><strong>{profile.stats.views.toLocaleString()}</strong></div><div className="stat-box"><span>Engagement</span><strong>{profile.stats.engagementRate}%</strong></div><div className="stat-box"><span>Topics</span><strong>{profile.stats.topics.length}</strong></div></section>
    <ArticleList items={profile.articles} empty="This author has no published articles yet." />
  </main>;
}

function ArticleList({ items, empty = 'No articles to display.' }) {
  if (!items?.length) return <div className="empty-state"><BookOpen size={24} /><p>{empty}</p></div>;
  return <div className="card-grid three-up">{items.map((article) => <article className="story-card" key={article.id}><div className="story-body"><span className="badge">{article.status || 'published'}</span><h3><Link to={`/article/${article.id}`}>{article.title}</Link></h3><p>{article.summary}</p><Link className="text-link" to={`/article/${article.id}`}>Open article</Link></div></article>)}</div>;
}

function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { apiRequest('/me/notifications').then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)); }, []);
  async function markRead(id) {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
      setItems((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
    } catch (actionError) { setError(actionError.message); }
  }
  if (!localStorage.getItem('cms-token')) return <AccessNotice />;
  return <main className="page-content"><PageHeading eyebrow="Updates" title="Notifications" description="Moderation, freshness and account updates." />
    {loading ? <div className="page-panel">Loading notifications…</div> : error ? <div className="page-panel error-panel">{error}</div> : items.length ? <div className="notification-list">{items.map((item) => <article className={`notification-item${item.read ? '' : ' unread'}`} key={item.id}><Bell size={18} /><div><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div>{!item.read && <button className="secondary-button" onClick={() => markRead(item.id)}>Mark read</button>}</article>)}</div> : <div className="empty-state">You’re all caught up.</div>}
  </main>;
}

function SettingsPage({ user }) {
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!localStorage.getItem('cms-token')) return;
    Promise.all([apiRequest('/me/profile'), apiRequest('/categories')])
      .then(([data, categoryData]) => { setProfile(data.user); setCategories(categoryData); })
      .catch((loadError) => setError(loadError.message));
  }, [user?.id]);
  if (!localStorage.getItem('cms-token')) return <AccessNotice />;
  if (!profile && !error) return <main className="page-panel">Loading account settings…</main>;
  async function save(event) {
    event.preventDefault();
    try {
      const result = await apiRequest('/me/profile', { method: 'PUT', body: JSON.stringify(profile) });
      setProfile(result.user);
      setMessage('Profile and interests saved.');
      setError('');
    } catch (saveError) { setError(saveError.message); }
  }
  return <main className="page-content"><PageHeading eyebrow="Account" title="Settings" description="Manage your profile and reading interests." />
    {error && <div className="page-panel error-panel">{error}</div>}
    {profile && <form className="section-card editor-form" onSubmit={save}>
      <label>Display name<input value={profile.name || ''} required minLength={2} maxLength={80} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
      <label>About you<textarea value={profile.bio || ''} maxLength={500} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></label>
      <label>Account email<input value={profile.email || ''} disabled /></label>
      <fieldset className="interest-fieldset"><legend>Topics you’re interested in</legend>{categories.map((category) => <label key={category.id} className="checkbox-label"><input type="checkbox" checked={(profile.preferences || []).includes(category.id)} onChange={(event) => setProfile({ ...profile, preferences: event.target.checked ? [...(profile.preferences || []), category.id] : (profile.preferences || []).filter((item) => item !== category.id) })} />{category.name}</label>)}</fieldset>
      {message && <p className="success-message" role="status">{message}</p>}
      <button className="primary-button" type="submit">Save settings</button>
    </form>}
  </main>;
}

function AuthorArticlesPage({ user }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user?.id) return;
    apiRequest(`/articles?authorId=${encodeURIComponent(user.id)}&limit=50`).then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message));
  }, [user?.id]);
  if (!user || !['author', 'admin'].includes(user.role)) return <AccessNotice message="Sign in with an author or admin account to manage articles." />;
  return <main className="page-content"><PageHeading eyebrow="Author workspace" title="My articles" action={<Link to="/author/new" className="primary-button"><PenLine size={16} />New article</Link>} />
    {error ? <div className="page-panel error-panel">{error}</div> : <div className="table-wrap section-card"><table><thead><tr><th>Article</th><th>Status</th><th>Risk</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{items.map((article) => <tr key={article.id}><td>{article.title}{article.review?.feedback && <small className="reason-line">Reviewer feedback: {article.review.feedback}</small>}</td><td><span className="status-badge">{article.status}</span></td><td>{article.moderation?.riskScore ?? '—'}</td><td>{new Date(article.updatedAt || article.createdAt).toLocaleDateString()}</td><td><Link className="text-link" to={article.status === 'published' ? `/article/${article.id}` : `/author/edit/${article.id}`}>{article.status === 'published' ? 'View' : 'Edit'}</Link></td></tr>)}</tbody></table>{!items.length && <p className="muted-copy">You haven’t created any articles yet.</p>}</div>}
  </main>;
}

function ArticleEditorPage({ user, token }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', summary: '', content: '', tags: '', categoryIds: [], coverImage: '', quiz: null });
  const [articleReview, setArticleReview] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  useEffect(() => {
    apiRequest('/categories').then(setCategories).catch((loadError) => setError(loadError.message));
    if (id) apiRequest(`/articles/${id}`).then((article) => {
      setForm({ title: article.title, summary: article.summary, content: article.content, tags: (article.tags || []).join(', '), categoryIds: article.categoryIds || [], coverImage: article.coverImage || '', quiz: article.quiz || null });
      setArticleReview({ status: article.status, review: article.review });
    }).catch((loadError) => setError(loadError.message));
  }, [id]);
  if (!token) return <AccessNotice message="Sign in with an author or admin account to write articles." />;
  if (!user) return <div className="page-panel">Checking your account…</div>;
  if (!['author', 'admin'].includes(user.role)) return <AccessNotice message="Only authors and admins can create or edit articles." />;

  async function save(event, submitForReview = false) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const payload = { ...form, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
    try {
      const result = id
        ? await apiRequest(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiRequest('/articles', { method: 'POST', body: JSON.stringify(payload) });
      const article = result.article;
      if (submitForReview) {
        const submission = await apiRequest(`/articles/${article.id}/submit`, { method: 'POST', body: JSON.stringify({}) });
        setMessage(`Article ${submission.article.status}. ${submission.moderation.reasons.join(' ')}`);
      } else {
        setMessage(article.status === 'pending' ? 'Changes saved. This article is awaiting admin approval.' : 'Draft saved.');
      }
      if (!id || submitForReview) navigate('/author/articles');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  }

  function updateQuizQuestion(questionIndex, update) {
    setForm((current) => ({
      ...current,
      quiz: {
        ...current.quiz,
        questions: current.quiz.questions.map((question, index) => index === questionIndex ? update(question) : question),
      },
    }));
  }

  function addQuizQuestion() {
    setForm((current) => ({
      ...current,
      quiz: {
        questions: [
          ...(current.quiz?.questions || []),
          { prompt: '', options: ['', ''], correctOptionIndex: 0 },
        ],
      },
    }));
  }

  function removeQuizQuestion(questionIndex) {
    setForm((current) => {
      const questions = current.quiz.questions.filter((_, index) => index !== questionIndex);
      return { ...current, quiz: questions.length ? { questions } : null };
    });
  }

  async function suggestImprovements() {
    setSuggesting(true);
    setError('');
    try {
      const result = await apiRequest('/ai/tools/writing', {
        method: 'POST',
        body: JSON.stringify({
          article: { title: form.title, summary: form.summary, content: form.content, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) },
        }),
      });
      setSuggestions(result.result.suggestions || []);
    } catch (suggestionError) { setError(suggestionError.message); }
    finally { setSuggesting(false); }
  }

  function applySuggestion(suggestion) {
    if (suggestion.type === 'title') setForm((current) => ({ ...current, title: suggestion.value }));
    if (suggestion.type === 'summary') setForm((current) => ({ ...current, summary: suggestion.value }));
    if (suggestion.type === 'tags') setForm((current) => ({ ...current, tags: [...new Set([...current.tags.split(',').map((tag) => tag.trim()).filter(Boolean), ...suggestion.value])].join(', ') }));
    setSuggestions((current) => current.filter((item) => item !== suggestion));
  }

  async function askAssistant(event) {
    event?.preventDefault();
    const prompt = assistantInput.trim();
    if (!prompt || assistantLoading) return;
    setAssistantMessages((current) => [...current, { role: 'user', text: prompt }]);
    setAssistantInput('');
    setAssistantLoading(true);
    try {
      const response = await apiRequest('/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({
          message: prompt,
          article: {
            title: form.title,
            summary: form.summary,
            content: form.content,
            tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          },
        }),
      });
      setAssistantMessages((current) => [...current, {
        role: 'assistant',
        text: response.text,
        note: response.note,
        action: response.action,
        suggestions: response.suggestions || [],
      }]);
    } catch (assistantError) {
      setAssistantMessages((current) => [...current, { role: 'assistant', text: assistantError.message, error: true }]);
    } finally {
      setAssistantLoading(false);
    }
  }

  return <main className="page-content"><PageHeading eyebrow="Author workspace" title={id ? 'Edit article' : 'Write an article'} description="Submitted articles and quizzes require administrator approval before publication." />
    <form className="section-card editor-form" onSubmit={(event) => save(event)}>
      {articleReview && <div className="note-card"><strong>Current status: {articleReview.status}</strong>{articleReview.review?.feedback && <p>Reviewer feedback: {articleReview.review.feedback}</p>}</div>}
      <div className="editor-toolbar"><span className="muted-copy">AI suggestions never overwrite your draft automatically.</span><button type="button" className="secondary-button" disabled={suggesting} onClick={suggestImprovements}><Sparkles size={15} />{suggesting ? 'Analyzing…' : 'Suggest improvements'}</button></div>
      <section className="editor-copilot" aria-labelledby="editor-copilot-title">
        <div className="section-header">
          <div><span className="eyebrow">Writing assistant</span><h2 id="editor-copilot-title">Ask about this draft</h2></div>
          <span className="copilot-role">{user.role === 'admin' ? 'Admin tools' : 'Author tools'}</span>
        </div>
        <div className="copilot-thread" aria-live="polite">
          {!assistantMessages.length && <p className="muted-copy">Ask for title ideas, a summary, tags, writing suggestions, or a quality check. Admins can also request an advisory moderation analysis.</p>}
          {assistantMessages.map((entry, index) => <article className={`copilot-message ${entry.role}${entry.error ? ' error' : ''}`} key={`${entry.role}-${index}`}>
            <strong>{entry.role === 'user' ? 'You' : 'Copilot'}{entry.action ? ` · ${entry.action}` : ''}</strong>
            <p>{entry.text}</p>
            {entry.suggestions?.map((suggestion, suggestionIndex) => <div className="copilot-suggestion" key={`${index}-${suggestionIndex}`}>
              <div><strong>{suggestion.type === 'note' ? 'Editorial note' : suggestion.type}</strong><p>{Array.isArray(suggestion.value) ? suggestion.value.join(', ') : suggestion.value}</p>{suggestion.reason && <small>{suggestion.reason}</small>}</div>
              {['title', 'summary', 'tags'].includes(suggestion.type) && <button type="button" className="secondary-button" onClick={() => applySuggestion(suggestion)}>Apply</button>}
            </div>)}
            {entry.note && <small className="copilot-note">{entry.note}</small>}
          </article>)}
          {assistantLoading && <p className="muted-copy" role="status">Copilot is reviewing the draft…</p>}
        </div>
        <div className="copilot-compose">
          <input aria-label="Ask the writing assistant" value={assistantInput} maxLength={1000} placeholder="e.g. Suggest a clearer title" onChange={(event) => setAssistantInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              askAssistant();
            }
          }} />
          <button type="button" className="primary-button" disabled={!assistantInput.trim() || assistantLoading} onClick={askAssistant}>{assistantLoading ? 'Thinking…' : 'Ask copilot'}</button>
        </div>
        <small className="copilot-note">Suggestions are optional. The copilot cannot publish content or bypass administrator approval.</small>
      </section>
      {suggestions.map((suggestion) => <div className="suggestion-card" key={`${suggestion.type}-${suggestion.value}`}><div><strong>{suggestion.type}</strong><p>{Array.isArray(suggestion.value) ? suggestion.value.join(', ') : suggestion.value}</p><small>{suggestion.reason}</small></div><div className="button-row"><button type="button" className="primary-button" onClick={() => applySuggestion(suggestion)}>Apply</button><button type="button" className="secondary-button" onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>Dismiss</button></div></div>)}
      <label>Title<input value={form.title} maxLength={180} minLength={4} required onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label>Summary<textarea value={form.summary} maxLength={500} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
      <label>Article content<textarea className="content-editor" value={form.content} minLength={30} maxLength={100000} required onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
      <section className="quiz-editor">
        <div className="section-header">
          <div><span className="eyebrow">Optional</span><h2>Article quiz</h2><p className="muted-copy">Add up to 20 questions with 2–6 answer options each.</p></div>
          <button type="button" className="secondary-button" disabled={(form.quiz?.questions.length || 0) >= 20} onClick={addQuizQuestion}>Add question</button>
        </div>
        {(form.quiz?.questions || []).map((question, questionIndex) => (
          <fieldset className="quiz-editor-question" key={questionIndex}>
            <div className="quiz-editor-heading">
              <legend>Question {questionIndex + 1}</legend>
              <button type="button" className="text-button" onClick={() => removeQuizQuestion(questionIndex)}>Remove question</button>
            </div>
            <label>Question text<textarea value={question.prompt} minLength={5} maxLength={300} required onChange={(event) => updateQuizQuestion(questionIndex, (current) => ({ ...current, prompt: event.target.value }))} /></label>
            <div className="quiz-editor-options">
              {question.options.map((option, optionIndex) => (
                <div className="quiz-editor-option" key={optionIndex}>
                  <label>
                    <span>Option {optionIndex + 1}{question.correctOptionIndex === optionIndex ? ' · Correct answer' : ''}</span>
                    <input value={option} maxLength={200} required onChange={(event) => updateQuizQuestion(questionIndex, (current) => ({ ...current, options: current.options.map((item, index) => index === optionIndex ? event.target.value : item) }))} />
                  </label>
                  <label className="correct-answer-choice">
                    <input type="radio" name={`correct-answer-${questionIndex}`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuizQuestion(questionIndex, (current) => ({ ...current, correctOptionIndex: optionIndex }))} />
                    Correct
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={question.options.length <= 2}
                    onClick={() => updateQuizQuestion(questionIndex, (current) => {
                      const options = current.options.filter((_, index) => index !== optionIndex);
                      const correctOptionIndex = current.correctOptionIndex === optionIndex
                        ? Math.max(0, optionIndex - 1)
                        : current.correctOptionIndex > optionIndex ? current.correctOptionIndex - 1 : current.correctOptionIndex;
                      return { ...current, options, correctOptionIndex };
                    })}
                  >Remove option</button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={question.options.length >= 6}
              onClick={() => updateQuizQuestion(questionIndex, (current) => ({ ...current, options: [...current.options, ''] }))}
            >Add option</button>
          </fieldset>
        ))}
      </section>
      <label>Tags, comma separated<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="publishing, analytics, AI" /></label>
      <label>Cover image URL<input type="url" value={form.coverImage} onChange={(event) => setForm({ ...form, coverImage: event.target.value })} placeholder="https://…" /></label>
      <fieldset className="interest-fieldset"><legend>Categories</legend>{categories.map((category) => <label key={category.id} className="checkbox-label"><input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={(event) => setForm({ ...form, categoryIds: event.target.checked ? [...form.categoryIds, category.id] : form.categoryIds.filter((item) => item !== category.id) })} />{category.name}</label>)}</fieldset>
      {error && <div className="error-panel inline-error">{error}</div>}
      {message && <p className="success-message" role="status">{message}</p>}
      <div className="button-row"><button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button className="primary-button" type="button" disabled={busy} onClick={(event) => save(event, true)}>{busy ? 'Submitting…' : 'Submit for review'}</button></div>
    </form>
  </main>;
}

function AuthorAnalyticsPage({ user }) {
  const [stats, setStats] = useState(null);
  const [days, setDays] = useState('30');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    apiRequest(`/me/analytics?days=${days}`).then((data) => setStats(data.stats)).catch((loadError) => setError(loadError.message));
  }, [days, user]);
  if (!user) return <AccessNotice />;
  return <main className="page-content"><PageHeading eyebrow="Performance" title="Author analytics" description="Views and engagement for your published articles." />
    <label className="sort-select">Date range<select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select></label>
    {error ? <div className="page-panel error-panel">{error}</div> : stats && <>
      <div className="stats-grid">{[['Views', stats.views], ['Likes', stats.likes], ['Shares', stats.shares], ['Comments', stats.comments], ['Engagement rate', `${stats.engagementRate}%`], ['Published', stats.publishedArticles]].map(([label, value]) => <div className="stat-box" key={label}><span>{label}</span><strong>{Number.isFinite(value) ? value.toLocaleString() : value}</strong></div>)}</div>
      <section className="section-card"><h2>Tracked engagement by day</h2><p className="muted-copy">Counts include interactions recorded by this CMS during the selected range.</p><div className="analytics-chart">{(stats.timeline || []).map((day) => {
        const maximum = Math.max(1, ...(stats.timeline || []).map((item) => item.views + item.likes + item.shares + item.comments));
        const total = day.views + day.likes + day.shares + day.comments;
        return <div className="analytics-chart-day" key={day.date} title={`${day.date}: ${total} interactions`}><span style={{ height: `${Math.max(total ? 7 : 2, total / maximum * 100)}%` }} /><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>;
      })}</div>{!stats.activityTracked && <p className="muted-copy">No tracked interactions are available in this period yet.</p>}</section>
      <section className="section-card"><h2>Top performing articles</h2><ArticleList items={stats.topArticles} /></section>
      <section className="section-card"><h2>Popular topics</h2><div className="tag-grid">{stats.topics.map((topic) => <span className="category-pill" key={topic.name}>{topic.name} · {topic.count}</span>)}</div></section>
    </>}
  </main>;
}

function FreshnessPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [linkChecks, setLinkChecks] = useState([]);
  async function runCheck() {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/freshness/check', { method: 'POST', body: JSON.stringify({}) });
      setLinkChecks(result.linkChecks || []);
      const data = await apiRequest('/me/freshness');
      setItems(data.items || []);
    } catch (checkError) { setError(checkError.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { apiRequest('/me/freshness').then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message)); }, []);
  if (!localStorage.getItem('cms-token')) return <AccessNotice />;
  return <main className="page-content"><PageHeading eyebrow="Content health" title="Freshness alerts" description="Find aging articles and safely check external links from your published content." action={<button className="primary-button" type="button" onClick={runCheck} disabled={loading}><Activity size={16} />{loading ? 'Checking…' : 'Run freshness check'}</button>} />
    {error && <div className="page-panel error-panel">{error}</div>}
    <section className="section-card"><h2>Articles needing attention</h2>{items.length ? <div className="notification-list">{items.map((item) => <article className="notification-item" key={item.id}><Clock3 size={18} /><div>    <strong><Link to={`/article/${item.articleId}`}>{item.title}</Link></strong><small>{item.reason}</small></div></article>)}</div> : <div className="empty-state">No open freshness alerts.</div>}</section>
    {linkChecks.length > 0 && <section className="section-card"><h2>External link checks</h2><div className="table-wrap"><table><thead><tr><th>Article</th><th>Link</th><th>Result</th><th>Details</th></tr></thead><tbody>    {linkChecks.map((item) => <tr key={`${item.articleId}-${item.url}`}><td>{item.articleId}</td><td><span className="link-cell">{item.url}</span></td><td>{item.status}</td><td>{item.reason}</td></tr>)}</tbody></table></div></section>}
  </main>;
}

function AIToolsPage() {
  const [tool, setTool] = useState('summary');
  const [form, setForm] = useState({ articleId: '', title: '', summary: '', content: '', tags: '' });
  const [articles, setArticles] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest('/articles?limit=50').then((data) => setArticles(data.items || [])).catch((loadError) => setError(loadError.message)); }, []);
  async function run(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const article = { title: form.title, summary: form.summary, content: form.content, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
      const payload = await apiRequest(`/ai/tools/${tool}`, { method: 'POST', body: JSON.stringify({ articleId: form.articleId || undefined, article }) });
      setResult(payload);
    } catch (runError) { setError(runError.message); }
    finally { setLoading(false); }
  }
  if (!localStorage.getItem('cms-token')) return <AccessNotice message="Sign in to run content and moderation analysis tools." />;
  return <main className="page-content"><PageHeading eyebrow="Editorial studio" title="AI tools" description="Deterministic local tools are available without external AI credentials. Review every result before applying it." />
    <form className="section-card editor-form" onSubmit={run}>
      <label>Tool<select value={tool} onChange={(event) => setTool(event.target.value)}><option value="summary">Article summarizer</option><option value="writing">Writing improvement</option><option value="title">Title suggestions</option><option value="tags">Tag suggestions</option><option value="grammar">Grammar & readability</option><option value="topics">Topic analyzer</option><option value="quality">Content quality & duplicate check</option><option value="moderation">Moderation analysis</option><option value="related">Related article finder</option></select></label>
      {tool === 'related' && <label>Published article<select value={form.articleId} onChange={(event) => setForm({ ...form, articleId: event.target.value })}><option value="">Choose article</option>{articles.filter((article) => article.status === 'published').map((article) => <option value={article.id} key={article.id}>{article.title}</option>)}</select></label>}
      <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label>Summary<textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
      <label>Content<textarea className="content-editor compact-editor" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
      <label>Tags, comma separated<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
      {error && <div className="error-panel inline-error">{error}</div>}
      <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Analyzing…' : <><WandSparkles size={16} />Run tool</>}</button>
    </form>
    <section className="section-card ai-result"><h2>Analysis result</h2>{result ? <><p className="muted-copy">{result.providerMessage || 'Local relevance engine'}</p><pre>{JSON.stringify(result.result, null, 2)}</pre></> : <p className="muted-copy">Choose a tool and provide an article to see suggestions.</p>}</section>
  </main>;
}

function ReviewQueuePage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reason, setReason] = useState('');
  const load = () => apiRequest('/moderation/queue').then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message));
  useEffect(() => { load(); }, []);
  async function decide(articleId, decision) {
    if (reason.trim().length < 3) {
      setError('Enter a review reason of at least 3 characters before making a decision.');
      return;
    }
    setBusyId(articleId);
    try {
      await apiRequest(`/moderation/articles/${articleId}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
      await load();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusyId(''); }
  }
  return <main className="page-content"><PageHeading eyebrow="Trust & safety" title="Moderation review queue" description="Review pending and quarantined submissions, including their article quizzes. Every decision is recorded in the audit history." />
    <label className="editor-label">Decision reason<textarea value={reason} minLength={3} maxLength={1000} required onChange={(event) => setReason(event.target.value)} /></label>
    {error && <div className="page-panel error-panel">{error}</div>}
    {items.length ? <div className="review-list">{items.map((article) => <article className="section-card review-card" key={article.id}><div><span className="status-badge">{article.status}</span><h2>{article.title}</h2><p>{article.summary}</p><small>Risk {article.moderation?.riskScore ?? 0} · {article.moderation?.reasons?.join(', ')}</small><p className="muted-copy">{article.content}</p>{article.quiz?.questions?.map((question, index) => <div className="note-card" key={`${article.id}-quiz-${index}`}><strong>Quiz {index + 1}: {question.prompt}</strong><p>{question.options.map((option, optionIndex) => `${optionIndex + 1}. ${option}${optionIndex === question.correctOptionIndex ? ' (correct)' : ''}`).join(' · ')}</p></div>)}</div><div className="button-row"><button className="primary-button" disabled={busyId === article.id} onClick={() => decide(article.id, 'approve')}>Approve & publish</button><button className="secondary-button" disabled={busyId === article.id} onClick={() => decide(article.id, 'request_changes')}>Request changes</button><button className="secondary-button" disabled={busyId === article.id} onClick={() => decide(article.id, 'reject')}>Reject</button><button className="secondary-button" disabled={busyId === article.id} onClick={() => decide(article.id, 'quarantine')}>Quarantine</button></div></article>)}</div> : <div className="empty-state">The review queue is clear.</div>}
  </main>;
}

function AdminReportsPage() {
  const [reports, setReports] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [tab, setTab] = useState('reports');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [reportData, appealData] = await Promise.all([apiRequest('/moderation/reports'), apiRequest('/moderation/appeals')]);
      setReports(reportData.items || []);
      setAppeals(appealData.items || []);
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => {
    Promise.all([apiRequest('/moderation/reports'), apiRequest('/moderation/appeals')])
      .then(([reportData, appealData]) => {
        setReports(reportData.items || []);
        setAppeals(appealData.items || []);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);
  async function review(kind, item, decision) {
    try {
      const endpoint = kind === 'appeal' ? `/moderation/appeals/${item.id}` : `/moderation/reports/${item.id}`;
      const body = kind === 'appeal' ? { decision, reason: 'Reviewed by an administrator.' } : { status: decision, decision: 'Reviewed by an administrator.' };
      await apiRequest(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
    } catch (reviewError) { setError(reviewError.message); }
  }
  return <main className="page-content"><PageHeading eyebrow="Trust & safety" title="Reports and appeals" description="Review community reports and moderation appeals." />
    <div className="auth-toggle"><button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports ({reports.length})</button><button className={tab === 'appeals' ? 'active' : ''} onClick={() => setTab('appeals')}>Appeals ({appeals.length})</button></div>
    {error && <div className="page-panel error-panel">{error}</div>}
    <div className="notification-list">{(tab === 'reports' ? reports : appeals).map((item) => <article className="notification-item" key={item.id}><ShieldCheck size={18} /><div><strong>{item.reason}</strong><small>{item.targetType ? `${item.targetType} ${item.targetId}` : `Article ${item.articleId}`} · {item.status}</small><small>{item.details || item.decision}</small></div>{item.status === 'open' && <div className="button-row">{tab === 'reports' ? <><button className="secondary-button" onClick={() => review('report', item, 'resolved')}>Resolve</button><button className="secondary-button" onClick={() => review('report', item, 'dismissed')}>Dismiss</button></> : <><button className="primary-button" onClick={() => review('appeal', item, 'approve')}>Approve appeal</button><button className="secondary-button" onClick={() => review('appeal', item, 'uphold')}>Uphold</button></>}</div>}</article>)}</div>
  </main>;
}

function AdminArticlesPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest(`/moderation/articles${status ? `?status=${encodeURIComponent(status)}` : ''}`)
      .then((data) => setItems(data.items || []))
      .catch((loadError) => setError(loadError.message));
  }, [status]);
  return <main className="page-content"><PageHeading eyebrow="Administration" title="Article management" description="Inspect all article states, including drafts, pending submissions and quarantined work." />
    <label className="sort-select">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All articles</option><option value="draft">Drafts</option><option value="pending">Pending</option><option value="changes_requested">Changes requested</option><option value="rejected">Rejected</option><option value="published">Published</option><option value="quarantined">Quarantined</option><option value="archived">Archived</option></select></label>
    {error && <div className="page-panel error-panel">{error}</div>}
    <div className="table-wrap section-card"><table><thead><tr><th>Title</th><th>Author</th><th>Status</th><th>Risk</th><th>Updated</th><th>Open</th></tr></thead><tbody>{items.map((article) => <tr key={article.id}><td>{article.title}</td><td>{article.authorId}</td><td>{article.status}</td><td>{article.moderation?.riskScore ?? '—'}</td><td>{new Date(article.updatedAt || article.createdAt).toLocaleDateString()}</td><td><Link className="text-link" to={article.status === 'published' ? `/article/${article.id}` : `/author/edit/${article.id}`}>View</Link></td></tr>)}</tbody></table>{!items.length && <p className="muted-copy">No matching articles.</p>}</div>
  </main>;
}

function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adjustment, setAdjustment] = useState({ delta: 1, reason: '' });
  const load = useCallback(async () => {
    try {
      const data = await apiRequest('/moderation/users');
      setUsers(data.items || []);
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => {
    apiRequest('/moderation/users')
      .then((data) => setUsers(data.items || []))
      .catch((loadError) => setError(loadError.message));
  }, []);

  async function updateRole(userId, role) {
    try {
      await apiRequest(`/moderation/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await load();
      setMessage('User role updated.');
    } catch (actionError) { setError(actionError.message); }
  }
  async function setRestriction(user) {
    const reason = window.prompt(`Temporary restriction reason for ${user.name}:`, 'Repeated spam activity');
    if (!reason) return;
    try {
      await apiRequest(`/moderation/users/${user.id}/restriction`, { method: 'PUT', body: JSON.stringify({ durationHours: 24, reason }) });
      await load();
    } catch (actionError) { setError(actionError.message); }
  }
  async function clearRestriction(user) {
    try {
      await apiRequest(`/moderation/users/${user.id}/restriction`, { method: 'DELETE' });
      await load();
    } catch (actionError) { setError(actionError.message); }
  }
  async function giveReputation(userId) {
    if (!adjustment.reason.trim()) { setError('Add a reason before changing reputation.'); return; }
    try {
      await apiRequest(`/moderation/users/${userId}/reputation`, { method: 'POST', body: JSON.stringify({ delta: Number(adjustment.delta), reason: adjustment.reason }) });
      await load();
      setMessage('Reputation event recorded.');
    } catch (actionError) { setError(actionError.message); }
  }

  return <main className="page-content"><PageHeading eyebrow="Administration" title="User management" description="Manage roles, short-term restrictions, and audited reputation events." />
    {error && <div className="page-panel error-panel">{error}</div>}{message && <p className="success-message">{message}</p>}
    <section className="section-card editor-form"><h2>Reputation adjustment</h2><label>Score change<select value={adjustment.delta} onChange={(event) => setAdjustment({ ...adjustment, delta: event.target.value })}><option value="1">+1</option><option value="3">+3</option><option value="-1">−1</option><option value="-3">−3</option></select></label><label>Reason<input value={adjustment.reason} maxLength={500} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} /></label><p className="muted-copy">Select a user below and click “Record event”; duplicate admin events with the same reason are rejected.</p></section>
    <div className="table-wrap section-card"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Reputation</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td><select aria-label={`Role for ${user.name}`} value={user.role} disabled={user.isCurrentUser} onChange={(event) => updateRole(user.id, event.target.value)}><option value="reader">Reader</option><option value="author">Author</option><option value="admin">Admin</option></select></td><td>{user.status}{user.restrictedUntil && <small> until {new Date(user.restrictedUntil).toLocaleString()}</small>}</td><td>{user.reputation ?? '—'}</td><td><div className="button-row">{user.status === 'restricted' ? <button className="secondary-button" onClick={() => clearRestriction(user)}>Lift restriction</button> : user.role !== 'admin' && <button className="secondary-button" onClick={() => setRestriction(user)}>Restrict 24h</button>}<button className="secondary-button" onClick={() => giveReputation(user.id)}>Record event</button></div></td></tr>)}</tbody></table></div>
  </main>;
}

function AdminTaxonomyPage() {
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const [categoryData, tagData] = await Promise.all([apiRequest('/categories'), apiRequest('/tags')]);
      setCategories(categoryData);
      setTags(tagData);
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => {
    Promise.all([apiRequest('/categories'), apiRequest('/tags')])
      .then(([categoryData, tagData]) => {
        setCategories(categoryData);
        setTags(tagData);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);
  async function createCategory(event) {
    event.preventDefault();
    try {
      await apiRequest('/categories', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', description: '' });
      setMessage('Category created.');
      await load();
    } catch (createError) { setError(createError.message); }
  }
  async function deleteCategory(category) {
    try {
      await apiRequest(`/categories/${category.id}`, { method: 'DELETE' });
      await load();
    } catch (deleteError) { setError(deleteError.message); }
  }
  async function renameTag(tag) {
    const name = window.prompt(`Rename tag “${tag.name}”:`, tag.name);
    if (!name || name === tag.name) return;
    try {
      await apiRequest(`/tags/${encodeURIComponent(tag.name)}`, { method: 'PUT', body: JSON.stringify({ name }) });
      await load();
    } catch (renameError) { setError(renameError.message); }
  }
  async function deleteTag(tag) {
    try {
      await apiRequest(`/tags/${encodeURIComponent(tag.name)}`, { method: 'DELETE' });
      await load();
    } catch (deleteError) { setError(deleteError.message); }
  }
  return <main className="page-content"><PageHeading eyebrow="Administration" title="Categories & tags" description="Keep editorial taxonomy consistent across published content." />
    {error && <div className="page-panel error-panel">{error}</div>}{message && <p className="success-message">{message}</p>}
    <form className="section-card editor-form" onSubmit={createCategory}><h2>Create category</h2><label>Name<input required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Description<textarea maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><button type="submit" className="primary-button">Add category</button></form>
    <section className="section-card"><h2>Categories</h2><div className="notification-list">{categories.map((category) => <article className="notification-item" key={category.id}><Tags size={17} /><div><strong>{category.name}</strong><small>{category.articleCount} published articles · {category.description}</small></div><button className="secondary-button" onClick={() => deleteCategory(category)}>Delete</button></article>)}</div></section>
    <section className="section-card"><h2>Tags</h2><div className="notification-list">{tags.map((tag) => <article className="notification-item" key={tag.name}><span className="category-pill">{tag.name}</span><div><small>{tag.articleCount} published articles</small></div><button className="secondary-button" onClick={() => renameTag(tag)}>Rename</button><button className="secondary-button" onClick={() => deleteTag(tag)}>Remove</button></article>)}</div></section>
  </main>;
}

function AdminAbusePage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest('/moderation/abuse').then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message)); }, []);
  return <main className="page-content"><PageHeading eyebrow="Trust & safety" title="Spam and abuse signals" description="Repeated posts and comments are logged for review. Automated signals do not permanently suspend accounts." />
    {error && <div className="page-panel error-panel">{error}</div>}
    {items.length ? <div className="notification-list">{items.map((item) => <article className="notification-item" key={item.id}><ShieldCheck size={18} /><div><strong>{item.type} · {item.severity}</strong><small>User {item.userId} · {new Date(item.createdAt).toLocaleString()}</small><small>{item.details}</small></div></article>)}</div> : <div className="empty-state">No suspicious activity has been recorded.</div>}
  </main>;
}

function AdminSettingsPage() {
  const [thresholds, setThresholds] = useState({ autoApprove: 29, review: 69 });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    apiRequest('/moderation/dashboard').then((data) => setThresholds(data.thresholds || { autoApprove: 29, review: 69 })).catch((loadError) => setError(loadError.message));
  }, []);
  async function save(event) {
    event.preventDefault();
    setError('');
    try {
      await apiRequest('/moderation/settings', { method: 'PUT', body: JSON.stringify({ moderationThresholds: { autoApprove: Number(thresholds.autoApprove), review: Number(thresholds.review) } }) });
      setMessage('Moderation thresholds saved.');
    } catch (saveError) { setError(saveError.message); }
  }
  return <main className="page-content"><PageHeading eyebrow="Administration" title="System settings" description="Configure deterministic moderation thresholds for new article submissions." />
    <form className="section-card editor-form" onSubmit={save}><label>Maximum risk score for low-risk classification<input type="number" min="0" max="98" value={thresholds.autoApprove} onChange={(event) => setThresholds({ ...thresholds, autoApprove: event.target.value })} /></label><label>Maximum risk score before quarantine<input type="number" min="1" max="100" value={thresholds.review} onChange={(event) => setThresholds({ ...thresholds, review: event.target.value })} /></label><p className="muted-copy">These thresholds classify moderation risk only; every submission still requires administrator approval before publication. Scores above the review threshold are quarantined for closer review.</p>{error && <div className="error-panel inline-error">{error}</div>}{message && <p className="success-message">{message}</p>}<button className="primary-button" type="submit">Save settings</button></form>
  </main>;
}

function AuditPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest('/moderation/audit').then((data) => setItems(data.items || [])).catch((loadError) => setError(loadError.message)); }, []);
  return <main className="page-content"><PageHeading eyebrow="Administration" title="Audit history" description="Administrative and content workflow actions with actor, reason, and outcome." />
    {error && <div className="page-panel error-panel">{error}</div>}
    <div className="table-wrap section-card"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason</th><th>Outcome</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.actorId}</td><td>{item.action}</td><td>{item.targetType} {item.targetId}</td><td>{item.reason}</td><td>{item.outcome}</td></tr>)}</tbody></table>{!items.length && <p className="muted-copy">No audit entries yet.</p>}</div>
  </main>;
}

function NotFoundPage() {
  return (
    <main className="page-panel error-panel">
      <h2>Page not found</h2>
      <Link to="/" className="primary-button">Return home</Link>
    </main>
  );
}

export default App;
