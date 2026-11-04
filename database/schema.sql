CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_subject VARCHAR(191) NULL,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NULL,
  role ENUM('student', 'organizer', 'judge', 'admin') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_google_subject (google_subject),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id VARCHAR(128) NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  session_data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_user_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS events (
  event_id VARCHAR(100) NOT NULL,
  organizer_id BIGINT UNSIGNED NULL,
  results_published_at DATETIME(3) NULL COMMENT 'UTC',
  title VARCHAR(180) NOT NULL,
  category VARCHAR(60) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  starts_at DATETIME(3) NOT NULL COMMENT 'UTC',
  ends_at DATETIME(3) NOT NULL COMMENT 'UTC',
  registration_deadline DATETIME(3) NOT NULL COMMENT 'UTC',
  venue VARCHAR(180) NOT NULL,
  format VARCHAR(40) NOT NULL,
  organizer VARCHAR(160) NOT NULL,
  capacity INT UNSIGNED NOT NULL,
  tags JSON NOT NULL,
  artwork VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_events_organizer (organizer_id),
  KEY idx_events_starts_at (starts_at),
  KEY idx_events_category_starts_at (category, starts_at),
  CONSTRAINT fk_events_organizer
    FOREIGN KEY (organizer_id) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT chk_events_capacity CHECK (capacity > 0),
  CONSTRAINT chk_events_time_range CHECK (ends_at >= starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS registrations (
  registration_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(100) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('registered', 'waitlisted', 'cancelled', 'attended') NOT NULL DEFAULT 'registered',
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (registration_id),
  UNIQUE KEY uq_registrations_event_user (event_id, user_id),
  KEY idx_registrations_user_status (user_id, status),
  CONSTRAINT fk_registrations_event
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
  CONSTRAINT fk_registrations_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(100) NULL,
  notification_type ENUM(
    'registration_confirmed',
    'waitlisted',
    'registration_cancelled',
    'waitlist_promoted',
    'results_published'
  ) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at DATETIME(3) NULL COMMENT 'UTC',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id),
  KEY idx_notifications_user_created (user_id, created_at),
  KEY idx_notifications_user_unread (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_event
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  subscription_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint VARCHAR(2048) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id),
  UNIQUE KEY uq_web_push_endpoint_hash (endpoint_hash),
  KEY idx_web_push_user (user_id),
  CONSTRAINT fk_web_push_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id VARCHAR(120) NOT NULL,
  details JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_log_id),
  KEY idx_admin_audit_created (created_at),
  KEY idx_admin_audit_actor (actor_id, created_at),
  CONSTRAINT fk_admin_audit_actor
    FOREIGN KEY (actor_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS teams (
  team_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(100) NOT NULL,
  team_name VARCHAR(50) NOT NULL,
  invitation_code CHAR(32) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id),
  UNIQUE KEY uq_teams_invitation_code (invitation_code),
  UNIQUE KEY uq_teams_id_event (team_id, event_id),
  KEY idx_teams_event (event_id),
  CONSTRAINT fk_teams_event
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
  CONSTRAINT fk_teams_creator
    FOREIGN KEY (created_by) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS team_members (
  team_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  UNIQUE KEY uq_team_members_event_user (event_id, user_id),
  KEY idx_team_members_user (user_id),
  CONSTRAINT fk_team_members_team_event
    FOREIGN KEY (team_id, event_id) REFERENCES teams (team_id, event_id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS submissions (
  submission_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(100) NOT NULL,
  team_id BIGINT UNSIGNED NOT NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  project_name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  repository_url VARCHAR(2048) NOT NULL DEFAULT '',
  demo_url VARCHAR(2048) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (submission_id),
  UNIQUE KEY uq_submissions_event_team (event_id, team_id),
  CONSTRAINT fk_submissions_team_event
    FOREIGN KEY (team_id, event_id) REFERENCES teams (team_id, event_id) ON DELETE CASCADE,
  CONSTRAINT fk_submissions_user
    FOREIGN KEY (submitted_by) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS event_judges (
  event_id VARCHAR(100) NOT NULL,
  judge_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, judge_id),
  KEY idx_event_judges_judge (judge_id),
  CONSTRAINT fk_event_judges_event
    FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
  CONSTRAINT fk_event_judges_judge
    FOREIGN KEY (judge_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_event_judges_assigner
    FOREIGN KEY (assigned_by) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS evaluations (
  evaluation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  judge_id BIGINT UNSIGNED NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  feedback TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (evaluation_id),
  UNIQUE KEY uq_evaluations_submission_judge (submission_id, judge_id),
  KEY idx_evaluations_judge (judge_id),
  CONSTRAINT fk_evaluations_submission
    FOREIGN KEY (submission_id) REFERENCES submissions (submission_id) ON DELETE CASCADE,
  CONSTRAINT fk_evaluations_judge
    FOREIGN KEY (judge_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT chk_evaluations_score CHECK (score <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
