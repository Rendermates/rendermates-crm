<?php
// Standalone tests: no WordPress install, Google API, customer data or outgoing email.
declare(strict_types=1);

$options = [];
$transients = [];
$scheduled = [];
$requests = [];
$http = null;
$assertions = 0;

function check(bool $condition, string $message): void {
    global $assertions;
    $assertions++;
    if (!$condition) {
        throw new RuntimeException($message);
    }
}
function rejects(callable $action, string $message): void {
    try { $action(); } catch (Throwable $e) { check(true, $message); return; }
    check(false, $message);
}
function wp_json_encode($value) { return json_encode($value, JSON_THROW_ON_ERROR); }
function wp_salt($scheme) { return 'fictional-local-test-salt-not-a-real-wordpress-secret'; }
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function update_option($key, $value, $autoload = null) { $GLOBALS['options'][$key] = $value; return true; }
function add_option($key, $value, $deprecated = '', $autoload = null) {
    if (isset($GLOBALS['options'][$key])) { return false; }
    $GLOBALS['options'][$key] = $value; return true;
}
function delete_option($key) { unset($GLOBALS['options'][$key]); return true; }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient($key, $value, $ttl) { $GLOBALS['transients'][$key] = $value; }
function sanitize_text_field($value) { return trim(preg_replace('/[\r\n\t]+/', ' ', strip_tags($value))); }
function sanitize_textarea_field($value) { return trim(strip_tags($value)); }
function is_email($value) { return filter_var($value, FILTER_VALIDATE_EMAIL); }
function wp_unslash($value) { return is_array($value) ? array_map('wp_unslash', $value) : stripslashes($value); }
function wp_generate_uuid4() {
    $h = bin2hex(random_bytes(16));
    return substr($h,0,8) . '-' . substr($h,8,4) . '-4' . substr($h,13,3) .
        '-a' . substr($h,17,3) . '-' . substr($h,20,12);
}
function wp_schedule_single_event($at, $hook) { $GLOBALS['scheduled'][] = [$at, $hook]; }
function wp_schedule_event($at, $interval, $hook) { $GLOBALS['scheduled'][] = [$at, $hook, $interval]; }
function wp_next_scheduled($hook) { return false; }
function wp_clear_scheduled_hook($hook) { $GLOBALS['scheduled'] = []; }
function wp_remote_post($url, $args) {
    $GLOBALS['requests'][] = [$url, $args];
    return ($GLOBALS['http'])($url, $args);
}
function is_wp_error($result) { return $result instanceof RuntimeException; }
function wp_remote_retrieve_response_code($result) { return $result['code']; }
function wp_remote_retrieve_body($result) { return json_encode($result['body']); }

final class TestDB {
    public $options = 'wp_options';
    public function prepare($sql, $value) { return $sql; }
    public function esc_like($value) { return $value; }
    public function get_col($sql) {
        return array_values(array_filter(array_keys($GLOBALS['options']), fn($s) => str_starts_with($s, '_rm_crm_lead_')));
    }
}
$wpdb = new TestDB();
require __DIR__ . '/../rendermates-crm/src/connector.php';

$fields = [
    ['name'=>'rm-name', 'value'=>'Fictional Lead — NOT A CUSTOMER'],
    ['name'=>'rm-phone', 'value'=>'+64 00 000 0000'],
    ['name'=>'rm-email', 'value'=>'fictional@example.invalid'],
    ['name'=>'rm-address', 'value'=>'Fictional address, Wellington'],
    ['name'=>'e-form-textarea-11', 'value'=>"Testing only.\nDo not contact."],
    ['name'=>'contractAmount', 'value'=>'99999'],
    ['name'=>'calendarSync', 'value'=>'forged'],
    ['name'=>'e-form-file-upload-9[]', 'value'=>['a photo']],
];
$lead = RM_CRM_Connector::map_fields($fields);
check($lead['clientName'] === $fields[0]['value'], 'name survives');
check($lead['message'] === "Testing only.\nDo not contact.", 'message lines survive');
check($lead['status'] === 'lead' && $lead['source'] === 'website', 'new website lead');
foreach (['startDate', 'endDate', 'contractAmount', 'claims', 'extras', 'calendarSync'] as $field) {
    check(!array_key_exists($field, $lead), 'no dates, financial fields or private sync data');
}
check(!isset($lead['e-form-file-upload-9[]']), 'files not copied');
$bad = $fields; $bad[2]['value'] = 'invalid';
rejects(fn() => RM_CRM_Connector::map_fields($bad), 'invalid email rejected');
rejects(fn() => RM_CRM_Connector::map_fields([]), 'missing fields rejected');
$bad = $fields; $bad[] = $fields[0];
rejects(fn() => RM_CRM_Connector::map_fields($bad), 'duplicate mapping rejected');
$bad = $fields; $bad[0]['value'] = ['array'];
rejects(fn() => RM_CRM_Connector::map_fields($bad), 'non-string rejected');
$bad = $fields; $bad[4]['value'] = str_repeat('a',20001);
rejects(fn() => RM_CRM_Connector::map_fields($bad), 'oversized message rejected');
$bad = $fields; $bad[0]['value'] = '<script>unsafe</script> Name';
check(!str_contains(RM_CRM_Connector::map_fields($bad)['clientName'], '<'), 'markup removed');

// Generate and use only an ephemeral test signing key in memory, never print it.
$key = openssl_pkey_new(['private_key_bits'=>2048, 'private_key_type'=>OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($key, $private);
$public = openssl_pkey_get_details($key)['key'];
$credential = [
    'type'=>'service_account', 'project_id'=>'rendermates-crm',
    'client_email'=>'crm-website-intake@rendermates-crm.iam.gserviceaccount.com',
    'private_key'=>$private, 'token_uri'=>'https://untrusted.invalid/',
];
$clean = RM_CRM_Connector::validate_credential($credential);
check(!isset($clean['token_uri']), 'untrusted destinations stripped');
$bad = $credential; $bad['client_email'] = 'calendar-writer@example.invalid';
rejects(fn() => RM_CRM_Connector::validate_credential($bad), 'other identity rejected');
$bad = $credential; $bad['project_id'] = 'other';
rejects(fn() => RM_CRM_Connector::validate_credential($bad), 'other project rejected');
$sealed = RM_CRM_Connector::seal($clean);
check(!str_contains($sealed, 'PRIVATE KEY'), 'credential encrypted');
check(RM_CRM_Connector::unseal($sealed) === $clean, 'encrypted credential roundtrip');
rejects(fn() => RM_CRM_Connector::unseal(substr($sealed,0,-8).'AAAAAAAA'), 'tampering rejected');
$options['_rm_crm_credentials'] = $sealed;

check(!RM_CRM_Connector::observe_response('{"success":false}', $lead), 'failed form not queued');
check(!RM_CRM_Connector::observe_response('{"success":"true"}', $lead), 'truthy nonboolean not queued');
check(!RM_CRM_Connector::observe_response('<html>503</html>', $lead), '503 not queued');
check(!RM_CRM_Connector::observe_response('garbage', $lead), 'malformed response not queued');
check(RM_CRM_Connector::observe_response('{"success":true,"data":{"message":"Thank you"}}', $lead), 'successful form queued');
check(count($wpdb->get_col('')) === 1, 'one persistent queue entry');
check($scheduled[0][1] === 'rm_crm_deliver', 'delivery scheduled');

// Exercise actual PHP output buffering: preserve bytes and enqueue only final success.
$_POST = ['post_id'=>'5507', 'form_id'=>'646e94a1', 'form_fields'=>$fields];
ob_start();
RM_CRM_Connector::capture();
echo '{"success":';
echo 'true,"data":{}}';
ob_end_flush();
$response = ob_get_clean();
check($response === '{"success":true,"data":{}}', 'original response unchanged');
check(count($wpdb->get_col('')) === 2, 'actual output handler queued');
$level = ob_get_level();
$_POST['form_id'] = 'another-form';
RM_CRM_Connector::capture();
check(ob_get_level() === $level, 'other form not observed');
$_POST['form_id'] = '646e94a1'; $_POST['post_id'] = 'another-post';
RM_CRM_Connector::capture();
check(ob_get_level() === $level, 'other page not observed');
$_POST['post_id'] = '5507';
ob_start(); RM_CRM_Connector::capture(); echo '{"success":true}'; ob_end_clean(); ob_end_clean();
check(count($wpdb->get_col('')) === 2, 'discarded output not queued');

$http = static function ($url, $args) use ($public) {
    check($args['redirection'] === 0, 'credentials never follow redirects');
    if ($url === 'https://oauth2.googleapis.com/token') {
        [$header, $payload, $signature] = explode('.', $args['body']['assertion']);
        $decode = static fn($s) => base64_decode(strtr($s,'-_','+/'));
        check(openssl_verify("$header.$payload", $decode($signature), $public, OPENSSL_ALGO_SHA256) === 1, 'JWT signature verified locally');
        $claims = json_decode($decode($payload),true);
        check($claims['scope'] === 'https://www.googleapis.com/auth/datastore', 'only datastore OAuth scope');
        check($claims['aud'] === $url, 'token audience fixed');
        return ['code'=>200,'body'=>['access_token'=>'fictional-test-token','expires_in'=>3600]];
    }
    check(str_starts_with($url, 'https://firestore.googleapis.com/v1/projects/rendermates-crm/databases/(default)/documents/jobs?documentId=website-'), 'create only exact jobs endpoint');
    $document = json_decode($args['body'],true);
    check($document['fields']['status']['stringValue'] === 'lead', 'Firestore lead encoding');
    check(isset($document['fields']['createdAt']['timestampValue']), 'timestamp encoding');
    check(!isset($document['fields']['calendarSync']), 'no sync metadata');
    return ['code'=>200,'body'=>['name'=>'fictional-created-document']];
};
RM_CRM_Connector::deliver();
check(count($wpdb->get_col('')) === 0, 'successful delivery removes queue only');
check(count(array_filter($requests, fn($r) => $r[0] === 'https://oauth2.googleapis.com/token')) === 1, 'token cached');
check($options['_rm_crm_status']['code'] === 'delivered', 'status delivered');

RM_CRM_Connector::observe_response('{"success":true}', $lead);
$queueKey = $wpdb->get_col('')[0];
$originalId = $options[$queueKey]['id'];
$http = fn($url, $args) => ['code'=>403,'body'=>['error'=>['status'=>'PERMISSION_DENIED']]];
RM_CRM_Connector::deliver();
check(isset($options[$queueKey]), 'failed delivery retains enquiry');
check($options[$queueKey]['id'] === $originalId && $options[$queueKey]['lead'] === $lead, 'retry keeps id and original data');
check($options[$queueKey]['attempts'] === 1 && $options[$queueKey]['next'] > time(), 'retry backed off');
RM_CRM_Connector::observe_response('{"success":true}', $lead);
$http = fn($url, $args) => ['code'=>409,'body'=>['error'=>['status'=>'ALREADY_EXISTS']]];
RM_CRM_Connector::deliver();
check(count($wpdb->get_col('')) === 1 && isset($options[$queueKey]), 'future retry does not block newer enquiry');
$options[$queueKey]['next'] = time();
RM_CRM_Connector::deliver();
check(!isset($options[$queueKey]), 'lost response duplicate treated as delivered without overwrite');

RM_CRM_Connector::observe_response('{"success":true}', $lead);
$queueKey = $wpdb->get_col('')[0];
$http = fn($url,$args) => ['code'=>409,'body'=>['error'=>['status'=>'OTHER_CONFLICT']]];
RM_CRM_Connector::deliver();
check(isset($options[$queueKey]), 'unrelated conflict not silently discarded');
$options[$queueKey]['next'] = time();
$http = fn($url,$args) => new RuntimeException('fictional transport failure');
RM_CRM_Connector::deliver();
check(isset($options[$queueKey]), 'transport failure retained');

RM_CRM_Connector::deactivate();
check(isset($options[$queueKey]) && isset($options['_rm_crm_credentials']), 'deactivation retains pending data and configuration');
check($scheduled === [], 'deactivation stops cron');
unset($options['_rm_crm_credentials']);
$level = ob_get_level();
RM_CRM_Connector::capture();
check(ob_get_level() === $level, 'unconfigured connector leaves form alone');
echo "PASS: $assertions assertions; fictional data and mocked transport only.\n";
