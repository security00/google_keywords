-- D1 migration: auth_users → auth_users_v2
-- 在 D1 控制台或通过 API 执行

-- Step 1: 创建新表（如果还没创建）
-- （已包含在 d1_student_schema.sql）

-- Step 2: 迁移现有用户数据（设为 admin 角色，永久使用）
INSERT INTO auth_users_v2 (id, email, password_hash, role, trial_started_at, trial_expires_at, created_at, updated_at)
SELECT id, email, password_hash, 'admin', created_at, '2099-12-31T23:59:59.000Z', created_at, updated_at
FROM auth_users;

-- Step 3: 验证迁移
SELECT count(*) as old_count FROM auth_users;
SELECT count(*) as new_count FROM auth_users_v2;

-- Step 4: 确认无误后，删旧表、改名
-- ⚠️ D1 不支持 RENAME TABLE，需要改代码引用
-- 方案：保留 auth_users_v2 名字，改代码引用
-- 或者：drop auth_users，重建 auth_users 从 v2

-- 推荐方案：直接改代码用 auth_users_v2
