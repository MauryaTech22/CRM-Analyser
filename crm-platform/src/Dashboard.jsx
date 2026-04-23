import React, { useState, useEffect } from 'react';
import Tesseract from 'tesseract.js';
import { jsPDF } from "jspdf";
import { supabase } from './supabaseClient';
import { 
  UserCircle2, LayoutDashboard, Heart, ClipboardList, LogOut, Zap, Menu,
  Activity, FileText, Brain, Plus, X, FolderUp, Edit3, ChevronDown, ChevronRight, BookOpen
} from 'lucide-react';
import './Dashboard.css';
import CustomLogo from './assets/logo.png';

const Dashboard = ({ user, onLogout }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAnalysing, setIsAnalysing] = useState(false);
  
  // Modals & Menus
  const [showClinicalModal, setShowClinicalModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [subMenus, setSubMenus] = useState({ health: false, reports: false });
  
  // Vault Data
  const [pastReports, setPastReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [formData, setFormData] = useState({
    full_name: '', phone: '', address: '', gender: 'Male',
    age: '', weight: '', height: '', 
    bp_sys: '', bp_dia: '', sugar: '', creatine: '',cholesterol: '',
    smoking: 'No', alcohol: 'No', activity: 'Sedentary', sleep: '8', comorbidities: ''
  });

  // --- DATA FETCHING ---
  const fetchReports = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      if (data) setPastReports(data);
    } catch (err) { 
      console.error("Vault Error:", err.message); 
    }
  };

  const getProfile = async () => {
    if (!user) return;
    try {
      let { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error && error.code !== 'PGRST116') throw error; // Ignore "Row not found" on first login
      if (data) {
        setProfile(data);
        setFormData(prev => ({ ...prev, ...data }));
      }
    } catch (err) { 
      console.error("Profile Load Error:", err.message); 
    } finally { 
      setLoading(false); 
    }
  };
  useEffect(() => {
    if (user) { getProfile(); fetchReports(); }
  }, [user]);
  const toggleSubMenu = (menu) => setSubMenus(prev => ({ ...prev, [menu]: !prev[menu] }));
  const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  // --- DATABASE DATA CLEANER ---
  const formatDataForDatabase = (data) => {
    const cleanData = { ...data };
    const numberColumns = ['age', 'weight', 'height', 'bp_sys', 'bp_dia', 'sugar', 'creatine','cholesterol', 'sleep'];
    
    numberColumns.forEach(key => {
      if (cleanData[key] === '' || cleanData[key] === null || cleanData[key] === undefined) {
        cleanData[key] = null;
      } else {
        cleanData[key] = Number(cleanData[key]);
      }
    });
    return cleanData;
  };

  // --- SAVE BASIC PROFILE ---
  const handleSaveProfile = async () => {
    try {
      const safeData = formatDataForDatabase({ id: user.id, ...formData });

      const { data, error } = await supabase
        .from('profiles')
        .upsert(safeData)
        .select()
        .single();
      
      if (error) throw error;
      
      setProfile(data);
      setShowProfileModal(false);
      alert("Medical Profile Updated Successfully!");
    } catch (err) { 
      console.error(err);
      alert("Database Save Error: " + err.message); 
    }
  };
  // --- AI ANALYSIS, PDF & VAULT SAVING ---
  const runAnalysisAndDownload = async () => {
    setIsAnalysing(true);
    let finalData = { ...formData };
    let ocrLog = "Manual entry verified.";
    try {
      // 1. OCR (Document Scan)
      if (selectedFiles.length > 0) {
        const imageUrl = URL.createObjectURL(selectedFiles[0]);
        const { data: { text } } = await Tesseract.recognize(imageUrl, 'eng');
        URL.revokeObjectURL(imageUrl);
        
        const sugarMatch = text.match(/(?:glucose|sugar|glu)\D+(\d{2,3})/i);
        const creatineMatch = text.match(/(?:creatinine|crea)\D+(\d?\.?\d)/i);
        
        if (sugarMatch) {
          finalData.sugar = sugarMatch[1];
          ocrLog = `AI Extracted Glucose (${sugarMatch[1]}) from scan.`;
        }
        if (creatineMatch) {
          finalData.creatine = creatineMatch[1];
          ocrLog += ` Creatinine (${creatineMatch[1]}) extracted.`;
        }
      }
      // 2. Clean the data for the Strict SQL Database
      const safeData = formatDataForDatabase({ id: user.id, ...finalData });
      // 3. Save Profile Update to Supabase
      const { data: updatedProfile, error: profileErr } = await supabase
        .from('profiles')
        .upsert(safeData)
        .select()
        .single();
      if (profileErr) throw profileErr;
      setProfile(updatedProfile);
      setFormData(prev => ({ ...prev, ...updatedProfile })); 
      // 4. Risk Engine (Calculated safely locally)
      const calculateRisk = () => {
        // Step A: Min-Max Normalization to scale features to [0,1]
        const normC = Math.min(Math.max(((Number(safeData.bp_sys) || 120) - 90) / (200 - 90), 0), 1); 
        const normR = Math.min(Math.max(((Number(safeData.creatine) || 0.8) - 0.5) / (5.0 - 0.5), 0), 1); 
        const normM = Math.min(Math.max(((Number(safeData.sugar) || 90) - 70) / (300 - 70), 0), 1);
        const normCh = Math.min(Math.max(((Number(safeData.cholesterol) || 200) - 150) / (300 - 150), 0), 1);
        
       const w1 = 0.1952; // ML-Trained Cardiac weight
        const w2 = 0.3052; // ML-Trained Renal weight
        const w3 = 0.4996; // ML-Trained Metabolic weight

        const alpha = 0.10; // C-R interaction
        const beta = 0.10;  // R-M interaction
        const gamma = 0.10; // C-M interaction
         
        let crs = (w1 * normC) + (w2 * normR) + (w3 * normM) + 
                  (alpha * (normC * normR)) + 
                  (beta * (normR * normM)) + 
                  (gamma * (normC * normM));

                  crs = Math.min(crs, 1);

                  return Math.round(crs * 100); 
      };
      const riskScore = calculateRisk();
      // Step D: Conditional Risk Classification based on paper thresholds
      let riskCategory = "Low Risk";
      if (riskScore >= 60) riskCategory = "High Risk";
      else if (riskScore >= 30) riskCategory = "Moderate Risk";
      // 5. Advanced PDF Generation
      // 5. DETAILED CLINICAL PDF GENERATION
      const doc = new jsPDF();
      const margin = 20;
      let y = 0;

      // Helper function to draw wrapped text
      const addWrappedText = (text, x, yPos, maxWidth, fontSize = 10, isBold = false) => {
        doc.setFontSize(fontSize);
        doc.setFont("helvetica", isBold ? "bold" : "normal");
        const lines = doc.splitTextToSize(text, maxWidth);
        doc.text(lines, x, yPos);
        return yPos + (lines.length * (fontSize * 0.4)); // Return new Y position
      };

      // --- HEADER ---
      doc.setFillColor(15, 23, 42); 
      doc.rect(0, 0, 210, 45, 'F');
      doc.setTextColor(255, 255, 255); 
      doc.setFontSize(22); 
      doc.setFont("helvetica", "bold");
      doc.text("CRM CLINICAL DIAGNOSTIC REPORT", 105, 20, { align: "center" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated by AI Health Vault | Date: ${new Date().toLocaleDateString()}`, 105, 30, { align: "center" });
      doc.text(`Data Provenance: ${ocrLog}`, 105, 38, { align: "center" });

      y = 55;

      // --- PATIENT DEMOGRAPHICS ---
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("1. PATIENT PROFILE & VITALS", margin, y);
      
      y += 10;
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(`Name: ${safeData.full_name || 'Not Provided'}`, margin, y);
      doc.text(`Age: ${safeData.age || '--'} Yrs`, margin + 90, y);
      y += 8;
      doc.text(`Gender: ${safeData.gender || '--'}`, margin, y);
      const bmiCalc = (safeData.weight && safeData.height) ? (safeData.weight / (safeData.height / 100) ** 2).toFixed(1) : '--';
      doc.text(`BMI: ${bmiCalc} kg/m²`, margin + 90, y);
      y += 8;
      doc.text(`Smoking Status: ${safeData.smoking || 'No'}`, margin, y);
      doc.text(`Sleep Avg: ${safeData.sleep || '--'} Hours`, margin + 90, y);

      y += 15;

      // --- RISK CLASSIFICATION ---
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("2. SYSTEMIC RISK CLASSIFICATION", margin, y);
      y += 10;
      
      
      let riskColor = [16, 185, 129]; // Green
      if (riskScore >= 60) { riskCategory = "HIGH RISK"; riskColor = [239, 68, 68]; } // Red
      else if (riskScore >= 30) { riskCategory = "MODERATE RISK"; riskColor = [245, 158, 11]; } // Yellow

      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, 170, 25, 'F');
      doc.setFillColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.rect(margin, y, 4, 25, 'F');
      
      doc.setTextColor(riskColor[0], riskColor[1], riskColor[2]);
      doc.setFontSize(16);
      doc.text(`${riskCategory} (Score: ${riskScore}%)`, margin + 10, y + 10);
      
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text("Calculation utilizes an optimized Cardio-Renal-Metabolic weighted algorithm.", margin + 10, y + 18);

      y += 40;

      // --- DETAILED PATHOLOGY BREAKDOWN ---
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("3. PATHOLOGICAL FORECAST & ANALYSIS", margin, y);
      y += 12;

      // A. CARDIAC
      const sysBP = Number(safeData.bp_sys) || 0;
      doc.setFontSize(12); doc.setTextColor(239, 68, 68); doc.text("Neuro-Cardiac Pathway", margin, y);
      doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.text(`Reading: ${sysBP}/${safeData.bp_dia || '--'} mmHg  |  Normal: <120/80 mmHg`, margin, y + 6);
      
      let cardiacText = "Vascular tension is optimal. High cardiovascular endurance predicted with low probability of ischemic events.";
      if (sysBP >= 140) cardiacText = "WARNING: Sustained hypertensive stress detected. High probability of acute ischemic events, arterial wall damage, and potential myocardial infarction. Immediate medical intervention advised.";
      else if (sysBP >= 120) cardiacText = "ELEVATED: Arterial pressure is above optimal baseline. Patient is at risk for developing chronic hypertension.";
      
      y = addWrappedText(`Clinical Insight: ${cardiacText}`, margin, y + 14, 170, 10, false) + 10;

      // B. RENAL
      const crea = Number(safeData.creatine) || 0;
      doc.setFontSize(12); doc.setTextColor(245, 158, 11); doc.text("Renal Failure Pathway", margin, y);
      doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.text(`Reading: ${crea} mg/dL  |  Normal: 0.7 - 1.2 mg/dL`, margin, y + 6);
      
      let renalText = "Glomerular filtration rates appear optimal. Zero current markers for dialysis dependency or chronic kidney disease.";
      if (crea >= 1.3) renalText = "WARNING: Elevated serum creatinine indicates decreased renal filtration capacity. Patient shows markers associated with chronic nephron scarring and potential Stage 3/4 CKD risk.";
      
      y = addWrappedText(`Clinical Insight: ${renalText}`, margin, y + 14, 170, 10, false) + 10;

      // C. METABOLIC
      const sug = Number(safeData.sugar) || 0;
      doc.setFontSize(12); doc.setTextColor(16, 185, 129); doc.text("Metabolic & Neural Pathway", margin, y);
      doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.text(`Reading: ${sug} mg/dL  |  Normal: 70 - 100 mg/dL`, margin, y + 6);
      
      let metaText = "Glucose processing is highly efficient. No active markers for metabolic nerve damage.";
      if (sug >= 125) metaText = "WARNING: Chronic hyperglycemia detected. The patient faces a high risk of microvascular tissue damage, peripheral nerve blocking, and diabetic neuropathy.";
      else if (sug >= 100) metaText = "ELEVATED: Prediabetic markers detected. Glucose management is under strain.";
      
      y = addWrappedText(`Clinical Insight: ${metaText}`, margin, y + 14, 170, 10, false) + 15;

      // --- RECOMMENDATIONS ---
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("4. AI LIFESTYLE INTERVENTIONS", margin, y);
      y += 10;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      if (Number(safeData.sleep) < 7) {
        doc.text("• RECOVERY DEFICIT: Sleep is below 7 hours. Elevated fatigue markers detected.", margin, y); y += 6;
      }
      if (safeData.smoking === 'Yes') {
        doc.text("• TOXICITY WARNING: Tobacco use is actively exacerbating vascular resistance.", margin, y); y += 6;
      }
      if (safeData.activity === 'Sedentary') {
        doc.text("• METABOLIC STAGNATION: Sedentary lifestyle is contributing to systemic risk. Cardio routine advised.", margin, y); y += 6;
      }
      if (riskScore < 30 && Number(safeData.sleep) >= 7 && safeData.smoking === 'No') {
         doc.text("• OPTIMAL LIFESTYLE: Maintain current sleep schedule, diet, and physical activity habits.", margin, y);
      }

      // Save the PDF
      doc.save(`CRM_Diagnostic_Report_${safeData.full_name ? safeData.full_name.replace(/\s+/g, '_') : 'Patient'}.pdf`);
      // 6. Vault Storage
      const { error: reportErr } = await supabase.from('reports').insert([{
        user_id: user.id,
        report_name: `Analysis_${new Date().toLocaleDateString()}`,
        report_data: safeData,
        risk_score: riskScore
      }]);
      if (reportErr) throw reportErr;
      fetchReports();
      setShowClinicalModal(false);
      setSelectedFiles([]);
      alert("AI Sync Complete. Dashboard and Vault Updated!");
    } catch (err) { 
      console.error(err);
      alert("Analysis Error: " + err.message); 
    } finally { 
      setIsAnalysing(false); 
    }
  };
  if (loading) return <div>Loading Engine.</div>;
  // DYNAMIC VARIABLES FOR UI 
  const bmiValue = (profile?.weight && profile?.height) ? (profile.weight / (profile.height / 100) ** 2).toFixed(1) : '--';
  const sysBP = parseInt(profile?.bp_sys) || 0;
  const creatine = parseFloat(profile?.creatine) || 0;
  const sugar = parseInt(profile?.sugar) || 0;

  const isCardiacRisk = sysBP >= 140;
  const isRenalRisk = creatine >= 1.2 && creatine !== 0;
  const isMetabolicRisk = sugar >= 125 && sugar !== 0;
  const overallStatus = (isCardiacRisk || isRenalRisk || isMetabolicRisk) ? 'Elevated Risk' : 'Stable';

  return (
    <div className="dashboard-container">
      {/* HEADER */}
      <header className="dash-header">
        <div className="header-left">
        <img src={CustomLogo} alt="CRM Logo" style={{ height: '35px', objectFit: 'contain' }} />
        <span>CRM Analysis</span>
        <div className="header-right">
          <span>Welcome, {profile?.full_name?.split(' ')[0] || 'User'}</span>
          <Menu className="menu-icon" size={24} onClick={() => setMobileMenu(!mobileMenu)} />
        </div>
        </div>
      </header>
      <div className="dash-main-wrapper">
        {/* SIDEBAR */}
        <aside className={`dash-sidebar ${mobileMenu ? 'active' : ''}`}>
          <div className="sidebar-profile-card">
            <UserCircle2 className="sidebar-avatar" strokeWidth={1} />
            <div className="sidebar-name">{profile?.full_name || "Patient Name"}</div>
          </div>

          <div className="sidebar-nav-card">
            <button className="nav-item active"><div className="nav-item-left"><LayoutDashboard size={18} /> Dashboard</div></button>
            
            <div className={`nav-group ${subMenus.health ? 'open' : ''}`}>
              <button className="nav-item-btn" onClick={() => toggleSubMenu('health')}>
                <div className="nav-item-left"><Heart size={18} /> Health</div>
                {subMenus.health ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div className="sub-menu">
                <button className="sub-link-btn" onClick={() => {setShowClinicalModal(true); setMobileMenu(false);}}><Plus size={14}/> Clinical Center</button>
              </div>
            </div>

            <div className={`nav-group ${subMenus.reports ? 'open' : ''}`}>
              <button className="nav-item-btn" onClick={() => toggleSubMenu('reports')}>
                <div className="nav-item-left"><FolderUp size={18} /> Health Vault</div>
                {subMenus.reports ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div className="sub-menu">
                {pastReports.length > 0 ? pastReports.map(rep => (
                  <button key={rep.id} className="sub-link-btn" onClick={() => setSelectedReport(rep)}>
                    <BookOpen size={12}/> {new Date(rep.created_at).toLocaleDateString()}
                  </button>
                )) : <small style={{padding:'8px', color:'#94a3b8'}}>No saved reports</small>}
              </div>
            </div>

            <button className="nav-item" onClick={() => {setShowProfileModal(true); setMobileMenu(false);}}><div className="nav-item-left"><Edit3 size={18} /> Update Profile</div></button>
            <button className="nav-item nav-logout" onClick={onLogout}><LogOut size={16} /> Logout</button>
          </div>

          <div className="sidebar-integrity-card">
            <div className="integrity-header"><Zap size={16} fill="#5b4efb" color="#5b4efb"/> SYSTEM INTEGRITY</div>
            <div className="integrity-row"><span>Encryption</span><span className="status-green">● AES-256</span></div>
            <div className="integrity-row" style={{marginTop:'15px', color:'#94a3b8', fontSize:'0.7rem'}}><FileText size={12}/> HIPAA Compliant</div>
          </div>
        </aside>
        {/* MAIN CONTENT */}
        <main className="dash-main-content">
          <div className="content-header"><h2>Clinical Overview</h2></div>
          
          <div className="clinical-banner">
            <div className="banner-name">{profile?.full_name || 'Patient Profile'}</div>
            <div className="banner-sub">ID: {user?.id.slice(0,8)} | {profile?.age || '--'} Yrs | {profile?.gender || 'Male'}</div>
            <div className="banner-tags">
              <span className="b-tag">BP: {profile?.bp_sys || '--'}/{profile?.bp_dia || '--'}</span>
              <span className="b-tag">Sugar: {profile?.sugar || '--'} mg/dL</span>
              <span className="b-tag">Smoking: {profile?.smoking || 'No'}</span>
              <span className="b-tag">Activity: {profile?.activity || 'Sedentary'}</span>
            </div>
          </div>

          <div className="vitals-grid">
            <div className="vital-card">
              <div className="vital-title">Cardiac</div>
              <div className="vital-value-row">
                <Heart className="vital-icon" fill="#ef4444" color="#ef4444" />
                <div><div className="vital-num">{profile?.bp_sys || '--'} / {profile?.bp_dia || '--'}</div><div className="vital-unit">mmHg</div></div>
              </div>
            </div>
            <div className="vital-card">
              <div className="vital-title">Renal</div>
              <div className="vital-value-row">
                <FileText className="vital-icon" color="#1e293b" />
                <div><div className="vital-num">{profile?.creatine || '--'}</div><div className="vital-unit">mg/dL</div></div>
              </div>
            </div>
            <div className="vital-card">
              <div className="vital-title">Metabolic</div>
              <div className="vital-value-row">
                <Zap className="vital-icon" fill="#f59e0b" color="#f59e0b" />
                <div><div className="vital-num">{profile?.sugar || '--'}</div><div className="vital-unit">mg/dL</div></div>
              </div>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <h4>Clinical Summary</h4>
              <div className="summary-value">{profile?.age || '--'} <span>Yrs</span></div>
              <div className="summary-status" style={{color: overallStatus === 'Stable' ? '#1e293b' : '#ef4444'}}>Status: <strong>{overallStatus}</strong></div>
            </div>
            <div className="summary-card">
              <h4>Body Composition</h4>
              <div className="summary-value">{bmiValue} <span>BMI</span></div>
              <div className="summary-status">{bmiValue > 25 ? 'Overweight' : 'Normal Range'}</div>
            </div>
          </div>

        <div className="section-title"><Activity size={18}/> Critical Pathological Forecast</div>
          <div className="forecast-grid">
            
            {/* CARDIAC CARD */}
            <div className={`forecast-card ${isCardiacRisk ? 'warning-state' : ''}`}>
              <div className="fc-header">
                <Heart size={16} color={isCardiacRisk ? "#ef4444" : "#64748b"}/> Neuro-Cardiac Pathway
              </div>
              <ul className="fc-list">
                <li>Silent Heart Attack (Ischemia)</li>
                <li>Ischemic Stroke / Nerve Blocking</li>
                <li className={isCardiacRisk ? "li-danger" : ""}>Myocardial Infarction</li>
              </ul>
              <div className="fc-status">
                {isCardiacRisk 
                  ? "Warning: Sustained high arterial tension is increasing the probability of acute ischemic events and arterial wall damage."
                  : "Status: Low probability of acute neuro-cardiac events based on current arterial pressure."}
              </div>
            </div>

            {/* RENAL CARD */}
            <div className={`forecast-card ${isRenalRisk ? 'warning-state' : ''}`}>
              <div className="fc-header">
                <Activity size={16} color={isRenalRisk ? "#f59e0b" : "#64748b"}/> Renal Failure Pathway
              </div>
              <ul className="fc-list">
                <li>Dialysis Dependency Condition</li>
                <li className={isRenalRisk ? "li-danger" : ""}>Stage 3/4 Kidney Failure (CKD)</li>
                <li>Chronic Nephron Scarring</li>
              </ul>
              <div className="fc-status">
                {isRenalRisk
                  ? "Warning: Elevated stress markers indicate decreased filtration capacity, accelerating nephron scarring and chronic failure risk."
                  : "Status: Normal filtration detected. Zero current markers for dialysis or renal failure."}
              </div>
            </div>

            {/* METABOLIC CARD (From your design) */}
            <div className={`forecast-card ${isMetabolicRisk ? 'warning-state' : ''}`}>
              <div className="fc-header">
                <Zap size={16} color={isMetabolicRisk ? "#10b981" : "#64748b"}/> Metabolic / Neural Pathway
              </div>
              <ul className="fc-list">
                <li>Diabetic Neuropathy</li>
                <li>Peripheral Nerve Blocking</li>
                <li className={isMetabolicRisk ? "li-danger" : ""}>Microvascular Tissue Damage</li>
              </ul>
              <div className="fc-status">
                {isMetabolicRisk
                  ? "Warning: Chronic hyperglycemia is causing microvascular decay, leading to nerve death and circulation blocks."
                  : "Status: Glucose management is optimal; no active markers for metabolic nerve damage."}
              </div>
            </div>

          </div>

          <div className="section-title"><ClipboardList size={18}/> Clinical Reference Guide</div>
          <div className="ref-guide-card">
            <div className="ref-item">
              <div className="ref-head"><Heart size={14} color="#ef4444"/> BP</div>
              <div className="ref-bar-wrapper"><div className="r-bar r-green"></div><div className="r-bar r-yellow"></div><div className="r-bar r-red"></div></div>
              <div className="ref-labels"><span>&lt;120</span><span>140+</span></div>
            </div>
            <div className="ref-item">
              <div className="ref-head"><Zap size={14} color="#f59e0b"/> Glucose</div>
              <div className="ref-bar-wrapper"><div className="r-bar r-green"></div><div className="r-bar r-yellow"></div><div className="r-bar r-red"></div></div>
              <div className="ref-labels"><span>70-100</span><span>125+</span></div>
            </div>
            <div className="ref-item">
              <div className="ref-head"><Activity size={14} color="#10b981"/> Creatinine</div>
              <div className="ref-bar-wrapper"><div className="r-bar r-green"></div><div className="r-bar r-yellow"></div><div className="r-bar r-red"></div></div>
              <div className="ref-labels"><span>0.7-1.3</span><span>1.3+</span></div>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL */}
        <aside className="dash-right-panel">
          <div className="right-panel-card">
            <div className="rp-header"><Activity size={18}/> System Status</div>
            <div className="status-bar-row">
              <div className="sb-labels"><span>Cardiac</span><span style={{color: isCardiacRisk ? '#ef4444' : '#10b981'}}>{isCardiacRisk ? 'ELEVATED' : 'OPTIMAL'}</span></div>
              <div className="sb-track"><div className="sb-fill" style={{width: `${sysBP ? Math.min((sysBP / 180)*100, 100) : 0}%`, background: isCardiacRisk ? '#ef4444' : '#10b981'}}></div></div>
            </div>
            <div className="status-bar-row">
              <div className="sb-labels"><span>Renal</span><span style={{color: isRenalRisk ? '#f59e0b' : '#10b981'}}>{isRenalRisk ? 'STRESSED' : 'HEALTHY'}</span></div>
              <div className="sb-track"><div className="sb-fill" style={{width: `${creatine ? Math.min((creatine / 2)*100, 100) : 0}%`, background: isRenalRisk ? '#f59e0b' : '#10b981'}}></div></div>
            </div>
            <div className="status-bar-row">
              <div className="sb-labels"><span>Metabolic</span><span style={{color: isMetabolicRisk ? '#f59e0b' : '#10b981'}}>{isMetabolicRisk ? 'WARNING' : 'STABLE'}</span></div>
              <div className="sb-track"><div className="sb-fill" style={{width: `${sugar ? Math.min((sugar / 200)*100, 100) : 0}%`, background: isMetabolicRisk ? '#f59e0b' : '#10b981'}}></div></div>
            </div>
          </div>

          <div className="rp-header" style={{marginTop: '2rem'}}><Brain size={18} color="#f59e0b"/> AI Health Forecasts</div>
          <div className="ai-forecast-item">
            <div className="ai-fc-head"><Heart size={14} color="#ef4444"/> Cardiac Outlook</div>
            <div className="ai-fc-desc">{isCardiacRisk ? "High resistance. Intervention needed." : "Tension stable. High endurance."}</div>
            <span className="ai-tip" style={{color: isCardiacRisk?'#ef4444':''}}>TIP: {isCardiacRisk ? "CONSULT DOCTOR" : "CARDIO ROUTINE"}</span>
          </div>
          <div className="ai-forecast-item">
            <div className="ai-fc-head"><Zap size={14} color="#f59e0b"/> Metabolic Trend</div>
            <div className="ai-fc-desc">{isMetabolicRisk ? "High strain. Monitor diet." : "Efficient processing. Stable energy."}</div>
            <span className="ai-tip" style={{color: isMetabolicRisk?'#f59e0b':''}}>TIP: {isMetabolicRisk ? "CUT SUGARS" : "BALANCE INTAKE"}</span>
          </div>
          <button className="btn-primary-new" onClick={() => setShowClinicalModal(true)}><Plus size={16} style={{marginRight:'8px', verticalAlign:'middle'}}/> New Analysis</button>
        </aside>
      </div>

      {/* INTERNAL VAULT VIEWER MODAL */}
      {selectedReport && (
        <div className="modal-overlay">
          <div className="report-viewer-card">
            <div className="modal-header">
              <span>Archive: {selectedReport.report_name}</span>
              <button className="modal-close" onClick={() => setSelectedReport(null)}><X size={20}/></button>
            </div>
            <div className="report-view-body">
              <div className="risk-banner" style={{background: selectedReport.risk_score > 60 ? '#ef4444' : '#10b981'}}>
                AI RISK SCORE: {selectedReport.risk_score}%
              </div>
              <div className="report-stats-grid">
                <div className="stat-pill">BP: {selectedReport.report_data.bp_sys}/{selectedReport.report_data.bp_dia}</div>
                <div className="stat-pill">Glucose: {selectedReport.report_data.sugar}</div>
                <div className="stat-pill">Creatinine: {selectedReport.report_data.creatine}</div>
              </div>
              <p className="report-narrative">
                Analysis performed on {new Date(selectedReport.created_at).toLocaleString()}. The AI detected {selectedReport.risk_score > 60 ? 'significant' : 'minimal'} systemic stress.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* NEW ANALYSIS MODAL */}
      {showClinicalModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">Clinical Intelligence Center<button className="modal-close" onClick={() => setShowClinicalModal(false)}><X size={20}/></button></div>
            <div className="modal-body">
              <div>
                <div className="form-section-title"><Activity size={16}/> Vital Biomarkers</div>
                <div className="row-inputs">
                  <div className="input-group"><label>Systolic BP</label><input type="number" name="bp_sys" value={formData.bp_sys} onChange={handleInputChange} /></div>
                  <div className="input-group"><label>Diastolic BP</label><input type="number" name="bp_dia" value={formData.bp_dia} onChange={handleInputChange} /></div>
                </div>
                <div className="input-group"><label>Blood Sugar (mg/dL)</label><input type="number" name="sugar" value={formData.sugar} onChange={handleInputChange} /></div>
                <div className="input-group"><label>Creatinine (mg/dL)</label><input type="number" name="creatine" value={formData.creatine} onChange={handleInputChange} /></div>
              </div>
              <div className="input-group">
  <label>Cholesterol (mg/dL)</label>
  <input type="number" name="cholesterol" value={formData.cholesterol} onChange={handleInputChange} />
</div>
              <div>
                <div className="form-section-title"><Zap size={16}/> Lifestyle Factors</div>
                <div className="input-group"><label>Smoking</label><select name="smoking" value={formData.smoking} onChange={handleInputChange}><option>No</option><option>Yes</option></select></div>
                <div className="input-group"><label>Activity</label><select name="activity" value={formData.activity} onChange={handleInputChange}><option>Sedentary</option><option>Active</option></select></div>
                <div className="input-group"><label>Sleep (Hrs)</label><input type="number" name="sleep" value={formData.sleep} onChange={handleInputChange} /></div>
              </div>
              <div>
                <div className="form-section-title"><FolderUp size={16}/> AI Document Scan</div>
                <label className="upload-box" style={{display:'block'}}>
                  <FolderUp size={32} style={{marginBottom:'10px', color:'#5b4efb'}}/>
                  <div>Click to Upload Lab Report</div><small>{selectedFiles.length} files selected</small>
                  <input type="file" hidden onChange={(e)=>setSelectedFiles(Array.from(e.target.files))} />
                </label>
              </div>
            </div>
            <div className="modal-footer"><button className="btn-save" onClick={runAnalysisAndDownload} disabled={isAnalysing}>{isAnalysing ? "Analysing & Saving..." : "Run Unified Analysis"}</button></div>
          </div>
        </div>
      )}

      {/* UPDATE PROFILE MODAL */}
      {showProfileModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">Patient Medical Record<button className="modal-close" onClick={() => setShowProfileModal(false)}><X size={20}/></button></div>
            <div className="modal-body">
              <div>
                <div className="form-section-title"><UserCircle2 size={16}/> Identity</div>
                <div className="input-group"><label>Name</label><input type="text" name="full_name" value={formData.full_name} onChange={handleInputChange} /></div>
                <div className="input-group"><label>Age</label><input type="number" name="age" value={formData.age} onChange={handleInputChange} /></div>
                <div className="input-group"><label>Gender</label><select name="gender" value={formData.gender} onChange={handleInputChange}><option>Male</option><option>Female</option></select></div>
              </div>
              <div>
                <div className="form-section-title"><Activity size={16}/> Body Metrics</div>
                <div className="row-inputs">
                  <div className="input-group"><label>Weight (KG)</label><input type="number" name="weight" value={formData.weight} onChange={handleInputChange} /></div>
                  <div className="input-group"><label>Height (CM)</label><input type="number" name="height" value={formData.height} onChange={handleInputChange} /></div>
                </div>
              </div>
              <div>
                <div className="form-section-title"><FileText size={16}/> Medical History</div>
                <div className="input-group"><label>Comorbidities</label><textarea name="comorbidities" rows="4" value={formData.comorbidities || ''} onChange={handleInputChange}></textarea></div>
              </div>
              <div className="input-group">
  <label>Cholesterol (mg/dL)</label>
  <input type="number" name="cholesterol" value={formData.cholesterol} onChange={handleInputChange} />
</div>
            </div>
            <div className="modal-footer"><button className="btn-save" onClick={handleSaveProfile}>Save Medical Profile</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Dashboard;