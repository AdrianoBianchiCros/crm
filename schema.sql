-- Rode este script no phpMyAdmin (aba SQL) dentro do banco criado no cPanel.
CREATE TABLE IF NOT EXISTS leads (
  id           VARCHAR(80)  NOT NULL PRIMARY KEY,
  nome         VARCHAR(255) NOT NULL,
  categoria    VARCHAR(255) NULL,
  telefone     VARCHAR(40)  NULL,
  whatsapp     VARCHAR(40)  NULL,
  wa_status    VARCHAR(80)  NULL,
  email        VARCHAR(255) NULL,
  instagram    VARCHAR(120) NULL,
  site         VARCHAR(500) NULL,
  cidade       VARCHAR(120) NULL,
  bairro       VARCHAR(120) NULL,
  atividade    VARCHAR(255) NULL,
  seguidores   INT          NULL,
  avaliacoes   INT          NULL,
  nota         DECIMAL(3,1) NULL,
  canais       INT          NULL,
  obs          TEXT         NULL,
  etapa        VARCHAR(20)  NOT NULL DEFAULT 'novo',
  followup     DATE         NULL,
  criado_em    DATETIME     NULL,
  atualizado_em TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_etapa (etapa),
  KEY idx_followup (followup)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_historico (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  lead_id  VARCHAR(80)  NOT NULL,
  quando   DATETIME     NOT NULL,
  tipo     VARCHAR(40)  NOT NULL,
  texto    TEXT         NOT NULL,
  KEY idx_lead (lead_id),
  CONSTRAINT fk_hist_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nome         VARCHAR(120) NOT NULL,
  usuario      VARCHAR(40)  NOT NULL UNIQUE,
  senha_hash   VARCHAR(255) NOT NULL,
  ativo        TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_login DATETIME     NULL,
  criado_em    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
