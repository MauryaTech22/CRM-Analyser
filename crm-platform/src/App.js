import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Dashboard from './Dashboard';
import './App.css';
import CustomLogo from './assets/logo.png';
function App() {
  const [session, setSession] = useState(null);
  const [isLogin, setIsLogin] = useState(true);
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: { data: { full_name: fullName, phone: mobile } } 
      });
      if (error) alert(error.message);
      else alert('Registration successful! Verify Your Email and log in.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="App">
      {!session ? (
        <div className="auth-page-wrapper">
          <div className="auth-container">
            <div className="auth-branding">
              <h1>CRM HEALTH RISK ANALYSER</h1>
              <img 
                src={CustomLogo} 
                alt="CRM Analysis Logo" 
                style={{ maxWidth: '350px', width: '100%', height: 'auto', marginTop: '1rem' }} 
              />
            </div>
            
            <div className="auth-form-card">
              <div className="auth-tabs">
                <button 
                  className={`auth-tab-btn ${isLogin ? 'active' : ''}`} 
                  onClick={() => setIsLogin(true)}
                >
                  LOGIN
                </button>
                <button 
                  className={`auth-tab-btn ${!isLogin ? 'active' : ''}`} 
                  onClick={() => setIsLogin(false)}
                >
                  REGISTER
                </button>
              </div>

              <form className="auth-form" onSubmit={handleAuth}>
                {!isLogin && (
                  <>
                    <input type="text" placeholder="Full Name" className="auth-input" value={fullName} onChange={e => setFullName(e.target.value)} required />
                    <input type="tel" placeholder="Mobile Number" className="auth-input" value={mobile} onChange={e => setMobile(e.target.value)} required />
                  </>
                )}
                <input type="email" placeholder="Email ID" className="auth-input" value={email} onChange={e => setEmail(e.target.value)} required />
                <input type="password" placeholder="Password" className="auth-input" value={password} onChange={e => setPassword(e.target.value)} required />
                
                <button type="submit" className="auth-submit-btn">
                  {isLogin ? 'ACCESS ANALYSER' : 'CREATE ACCOUNT'}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <Dashboard user={session.user} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;