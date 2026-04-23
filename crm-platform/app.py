import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import MinMaxScaler
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from xgboost import XGBClassifier
from sklearn.metrics import accuracy_score, roc_auc_score

# 1. SIMULATE YOUR INTEGRATED CRM DATASET
# In reality, you will load your merged CSV file here: 
# df = pd.read_csv('integrated_crm_dataset.csv')
np.random.seed(42)
data_size = 1000
df = pd.DataFrame({
    'bp_sys': np.random.randint(90, 180, data_size),
    'sugar': np.random.randint(70, 250, data_size),
    'creatinine': np.random.uniform(0.5, 4.0, data_size),
    'age': np.random.randint(20, 80, data_size),
    'target': np.random.randint(0, 2, data_size) # 1 = High Risk, 0 = Low Risk
})

# 2. PREPROCESSING (Min-Max Normalization as per paper)
X = df[['bp_sys', 'creatinine', 'sugar']] # C, R, M features
y = df['target']

scaler = MinMaxScaler()
X_scaled = scaler.fit_transform(X)

# 3. TRAIN / TEST SPLIT (70% Train, 30% Test/Validation as per methodology)
X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.30, random_state=42)

# 4. MODEL TRAINING LAYER
print("--- Training Machine Learning Models ---")

# A. Support Vector Machine
svm_model = SVC(probability=True)
svm_model.fit(X_train, y_train)
print(f"SVM Accuracy: {accuracy_score(y_test, svm_model.predict(X_test)):.2f}")

# B. XGBoost
xgb_model = XGBClassifier(eval_metric='logloss')
xgb_model.fit(X_train, y_train)
print(f"XGBoost Accuracy: {accuracy_score(y_test, xgb_model.predict(X_test)):.2f}")

# C. Logistic Regression (Used to extract coefficient weights!)
log_reg = LogisticRegression()
log_reg.fit(X_train, y_train)
print(f"Logistic Regression Accuracy: {accuracy_score(y_test, log_reg.predict(X_test)):.2f}")

# 5. EXTRACT OPTIMIZED WEIGHTS (Using paper formula: w_j = |B_j| / sum(|B|))
coefficients = log_reg.coef_[0]
abs_coef = np.abs(coefficients)
sum_abs_coef = np.sum(abs_coef)

# Calculate final optimal weights for C, R, and M
w1_cardiac = abs_coef[0] / sum_abs_coef
w2_renal = abs_coef[1] / sum_abs_coef
w3_metabolic = abs_coef[2] / sum_abs_coef

print("\n--- OPTIMIZED CRM WEIGHTS DRIVEN BY ML ---")
print(f"w1 (Cardiac Weight): {w1_cardiac:.4f}")
print(f"w2 (Renal Weight): {w2_renal:.4f}")
print(f"w3 (Metabolic Weight): {w3_metabolic:.4f}")