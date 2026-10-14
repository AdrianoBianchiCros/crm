<?php
// API do Funil de Prospecção: salva os leads no MySQL (phpMyAdmin) do HostGator.
require __DIR__ . '/config.php';

ini_set('session.cookie_httponly', '1');
ini_set('session.use_strict_mode', '1');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ini_set('session.cookie_secure', '1');
session_name('crm_sess');
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail($msg, $code = 400) { out(['error' => $msg], $code); }

function pdo() {
  static $pdo = null;
  if ($pdo) return $pdo;
  try {
    $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
  } catch (PDOException $e) {
    $code = isset($e->errorInfo[1]) ? (int)$e->errorInfo[1] : (int)$e->getCode();
    if (!$code && preg_match('/\[(\d{4})\]/', $e->getMessage(), $m)) $code = (int)$m[1];
    $why = [
      1045 => 'usuário ou senha do banco incorretos (DB_USER / DB_PASS)',
      1044 => 'o usuário não tem permissão neste banco (adicione o usuário ao banco no cPanel com Todos os privilégios)',
      1049 => 'o banco informado em DB_NAME não existe',
      2002 => 'servidor do banco não encontrado (DB_HOST deve ser localhost)',
      2005 => 'servidor do banco não encontrado (DB_HOST deve ser localhost)',
    ];
    fail('Não foi possível conectar ao banco: ' . ($why[$code] ?? 'erro ' . $code) . '. Confira o config.php.', 500);
  }
  return $pdo;
}

// campo do JS => coluna no banco
$FIELDS = [
  'nome' => 'nome', 'categoria' => 'categoria', 'telefone' => 'telefone', 'whatsapp' => 'whatsapp',
  'waStatus' => 'wa_status', 'email' => 'email', 'instagram' => 'instagram', 'site' => 'site',
  'cidade' => 'cidade', 'bairro' => 'bairro', 'atividade' => 'atividade', 'seguidores' => 'seguidores',
  'avaliacoes' => 'avaliacoes', 'nota' => 'nota', 'canais' => 'canais', 'obs' => 'obs',
  'etapa' => 'etapa', 'followup' => 'followup', 'criadoEm' => 'criado_em',
];
$STAGES = ['novo', 'contatado', 'respondeu', 'reuniao', 'proposta', 'fechado', 'perdido'];

function toDb($k, $v) {
  global $STAGES;
  if ($v === '' || $v === null) return in_array($k, ['nome', 'etapa']) ? ($k === 'etapa' ? 'novo' : '') : null;
  switch ($k) {
    case 'seguidores': case 'avaliacoes': case 'canais': return is_numeric($v) ? (int)$v : null;
    case 'nota': return is_numeric($v) ? (float)$v : null;
    case 'followup': return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    case 'criadoEm': $t = strtotime($v); return $t ? gmdate('Y-m-d H:i:s', $t) : null;
    case 'etapa': return in_array($v, $STAGES, true) ? $v : 'novo';
    default: return is_scalar($v) ? (string)$v : null;
  }
}
function isoUtc($dt) { return $dt ? str_replace(' ', 'T', $dt) . 'Z' : ''; }

function writeLead($id, $data, $isNew) {
  global $FIELDS;
  $db = pdo();
  $cols = []; $vals = [];
  foreach ($FIELDS as $k => $col) {
    if (!array_key_exists($k, $data)) continue;
    $cols[] = $col; $vals[] = toDb($k, $data[$k]);
  }
  $db->beginTransaction();
  try {
    if ($isNew) {
      if (!array_key_exists('nome', $data)) fail('Lead sem nome.');
      $ph = implode(',', array_fill(0, count($cols) + 1, '?'));
      $upd = implode(',', array_map(function ($c) { return "$c=VALUES($c)"; }, $cols));
      $db->prepare('INSERT INTO leads (id,' . implode(',', $cols) . ") VALUES ($ph) ON DUPLICATE KEY UPDATE $upd")
         ->execute(array_merge([$id], $vals));
    } elseif ($cols) {
      $st = $db->prepare('UPDATE leads SET ' . implode(',', array_map(function ($c) { return "$c=?"; }, $cols)) . ' WHERE id=?');
      $st->execute(array_merge($vals, [$id]));
    }
    if (!$isNew) {
      $chk = $db->prepare('SELECT 1 FROM leads WHERE id=?'); $chk->execute([$id]);
      if (!$chk->fetchColumn()) { $db->rollBack(); fail('Lead não encontrado.', 404); }
    }
    if (array_key_exists('historico', $data) && is_array($data['historico'])) {
      $db->prepare('DELETE FROM lead_historico WHERE lead_id=?')->execute([$id]);
      $ins = $db->prepare('INSERT INTO lead_historico (lead_id,quando,tipo,texto) VALUES (?,?,?,?)');
      foreach ($data['historico'] as $h) {
        $t = strtotime(isset($h['t']) ? $h['t'] : '') ?: time();
        $ins->execute([$id, gmdate('Y-m-d H:i:s', $t), mb_substr((string)($h['tipo'] ?? 'Nota'), 0, 40), (string)($h['texto'] ?? '')]);
      }
    }
    $db->commit();
  } catch (Exception $e) { if ($db->inTransaction()) $db->rollBack(); fail('Erro ao salvar no banco.', 500); }
}

$a = $_GET['a'] ?? '';
$in = json_decode(file_get_contents('php://input'), true) ?: [];

/* ---------- usuários ---------- */
function noUsers() { return !pdo()->query('SELECT 1 FROM usuarios LIMIT 1')->fetchColumn(); }
function validUser($in) {
  $nome = trim((string)($in['nome'] ?? ''));
  $usuario = strtolower(trim((string)($in['usuario'] ?? '')));
  $senha = (string)($in['senha'] ?? '');
  if ($nome === '') fail('Informe o nome.');
  if (!preg_match('/^[a-z0-9._-]{3,40}$/', $usuario)) fail('Usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.');
  if (strlen($senha) < 8) fail('A senha precisa ter pelo menos 8 caracteres.');
  return [$nome, $usuario, $senha];
}
function createUser($in) {
  list($nome, $usuario, $senha) = validUser($in);
  try {
    pdo()->prepare('INSERT INTO usuarios (nome,usuario,senha_hash) VALUES (?,?,?)')
         ->execute([$nome, $usuario, password_hash($senha, PASSWORD_DEFAULT)]);
  } catch (Exception $e) { fail('Esse usuário já existe.', 409); }
  return ['id' => (int)pdo()->lastInsertId(), 'nome' => $nome, 'usuario' => $usuario];
}
function startSession($u) {
  session_regenerate_id(true);
  $_SESSION['user'] = ['id' => (int)$u['id'], 'nome' => $u['nome'], 'usuario' => $u['usuario']];
}

if ($a === 'me') {
  if (!empty($_SESSION['user'])) out(['user' => $_SESSION['user']]);
  out(['user' => null, 'setup' => noUsers()]);
}
if ($a === 'setup') {
  // Só funciona no primeiro acesso, enquanto não existe nenhum usuário.
  if (!noUsers()) fail('O primeiro usuário já foi criado. Faça login.', 403);
  $u = createUser($in); startSession($u); out(['user' => $_SESSION['user']]);
}
if ($a === 'login') {
  $st = pdo()->prepare('SELECT id,nome,usuario,senha_hash FROM usuarios WHERE usuario=? AND ativo=1');
  $st->execute([strtolower(trim((string)($in['usuario'] ?? '')))]);
  $u = $st->fetch();
  if ($u && password_verify((string)($in['senha'] ?? ''), $u['senha_hash'])) {
    pdo()->prepare('UPDATE usuarios SET ultimo_login=NOW() WHERE id=?')->execute([$u['id']]);
    startSession($u); out(['user' => $_SESSION['user']]);
  }
  sleep(1); fail('Usuário ou senha incorretos.', 401);
}
if ($a === 'logout') { $_SESSION = []; session_destroy(); out(['ok' => true]); }
if (empty($_SESSION['user'])) fail('Faça login.', 401);
$me = $_SESSION['user'];
session_write_close();

if ($a === 'add_user') { $u = createUser($in); out(['user' => ['nome' => $u['nome'], 'usuario' => $u['usuario']]]); }
if ($a === 'change_password') {
  $st = pdo()->prepare('SELECT senha_hash FROM usuarios WHERE id=?'); $st->execute([$me['id']]);
  if (!password_verify((string)($in['atual'] ?? ''), (string)$st->fetchColumn())) { sleep(1); fail('Senha atual incorreta.', 403); }
  $nova = (string)($in['nova'] ?? '');
  if (strlen($nova) < 8) fail('A nova senha precisa ter pelo menos 8 caracteres.');
  pdo()->prepare('UPDATE usuarios SET senha_hash=? WHERE id=?')->execute([password_hash($nova, PASSWORD_DEFAULT), $me['id']]);
  out(['ok' => true]);
}

/* ---------- prompts salvos ---------- */
// A tabela é criada sozinha no primeiro uso, já com o prompt de prospecção inicial.
function promptsTable() {
  $db = pdo();
  if ($db->query("SHOW TABLES LIKE 'prompts'")->fetchColumn()) return $db;
  $db->exec("CREATE TABLE IF NOT EXISTS prompts (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    titulo        VARCHAR(160) NOT NULL,
    texto         MEDIUMTEXT   NOT NULL,
    atualizado_em TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  $seed = __DIR__ . '/prompt-inicial.txt';
  if (is_file($seed))
    $db->prepare('INSERT INTO prompts (titulo,texto) VALUES (?,?)')->execute(['Prospecção com Apify', file_get_contents($seed)]);
  return $db;
}
if ($a === 'prompts') {
  $rows = promptsTable()->query('SELECT id,titulo,texto,atualizado_em FROM prompts ORDER BY titulo')->fetchAll();
  foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['atualizado_em'] = isoUtc($r['atualizado_em']); }
  out(['prompts' => $rows]);
}
if ($a === 'prompt_save') {
  $titulo = mb_substr(trim((string)($in['titulo'] ?? '')), 0, 160);
  $texto = (string)($in['texto'] ?? '');
  if ($titulo === '') fail('Dê um título ao prompt.');
  if (trim($texto) === '') fail('O prompt está vazio.');
  $db = promptsTable(); $id = (int)($in['id'] ?? 0);
  if ($id) $db->prepare('UPDATE prompts SET titulo=?,texto=? WHERE id=?')->execute([$titulo, $texto, $id]);
  else { $db->prepare('INSERT INTO prompts (titulo,texto) VALUES (?,?)')->execute([$titulo, $texto]); $id = (int)$db->lastInsertId(); }
  out(['id' => $id]);
}
if ($a === 'prompt_delete') {
  promptsTable()->prepare('DELETE FROM prompts WHERE id=?')->execute([(int)($in['id'] ?? 0)]);
  out(['ok' => true]);
}

switch ($a) {
  case 'list':
    $db = pdo();
    $rows = $db->query('SELECT * FROM leads')->fetchAll();
    $hist = [];
    foreach ($db->query('SELECT lead_id,quando,tipo,texto FROM lead_historico ORDER BY quando,id') as $h)
      $hist[$h['lead_id']][] = ['t' => isoUtc($h['quando']), 'tipo' => $h['tipo'], 'texto' => $h['texto']];
    $leads = [];
    foreach ($rows as $r) {
      $l = ['id' => $r['id']];
      foreach ($FIELDS as $k => $col) $l[$k] = $r[$col];
      foreach (['seguidores', 'avaliacoes', 'canais'] as $k) $l[$k] = $l[$k] === null ? null : (int)$l[$k];
      $l['nota'] = $l['nota'] === null ? null : (float)$l['nota'];
      $l['followup'] = $l['followup'] ?: '';
      $l['criadoEm'] = isoUtc($l['criadoEm']);
      $l['historico'] = $hist[$r['id']] ?? [];
      $leads[] = $l;
    }
    out(['leads' => $leads]);
  case 'set':
  case 'update':
    $id = (string)($in['id'] ?? '');
    if ($id === '' || strlen($id) > 80) fail('ID inválido.');
    writeLead($id, is_array($in['data'] ?? null) ? $in['data'] : [], $a === 'set');
    out(['ok' => true]);
  case 'delete':
    pdo()->prepare('DELETE FROM leads WHERE id=?')->execute([(string)($in['id'] ?? '')]);
    out(['ok' => true]);
  default:
    fail('Ação desconhecida.');
}
