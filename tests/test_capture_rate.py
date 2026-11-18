"""Offline checks: bounded retries, caching and auth failures must never issue extra requests."""
import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
class CapturePolicyTests(unittest.TestCase):
 def setUp(self):
  spec=importlib.util.spec_from_file_location('capture_under_test',ROOT/'scripts/capture-zeus.py')
  self.c=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.c)
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.c.CACHE=pathlib.Path(self.temp.name)/'responses';self.c.CACHE.mkdir()
 def response(self,code=200,data=None,exit=0):
  return types.SimpleNamespace(returncode=exit,stderr='',stdout=json.dumps(data or {'code':0,'data':{'ok':True}})+'\nZEUS_HTTP_STATUS:'+str(code))
 def test_cached_response_never_calls_platform(self):
  (self.c.CACHE/'cached.json').write_text(json.dumps({'code':0,'data':{'id':1}}))
  with patch.object(self.c.subprocess,'run') as call:
   self.assertEqual(self.c.get('rule/search_new',{},'cached')['data']['id'],1)
   call.assert_not_called()
 def test_429_waits_before_retry_and_caches_only_success(self):
  with patch.object(self.c.subprocess,'run',side_effect=[self.response(429),self.response()]) as call,patch.object(self.c.time,'sleep') as sleep:
   self.c.get('rule/search_new',{},'limited')
   self.assertEqual(call.call_count,2)
   self.assertIn(unittest.mock.call(60),sleep.call_args_list)
   self.assertTrue((self.c.CACHE/'limited.json').exists())
 def test_expired_auth_stops_without_retry_or_cache(self):
  with patch.object(self.c.subprocess,'run',return_value=self.response(302)) as call:
   with self.assertRaisesRegex(RuntimeError,'authentication'):self.c.get('rule/search_new',{},'expired')
   self.assertEqual(call.call_count,1)
   self.assertFalse((self.c.CACHE/'expired.json').exists())
 def test_persistent_rate_limit_has_bounded_requests(self):
  with patch.object(self.c.subprocess,'run',return_value=self.response(429)) as call,patch.object(self.c.time,'sleep'):
   with self.assertRaisesRegex(RuntimeError,'bounded cooldowns'):self.c.get('rule/search_new',{},'always-limited')
   self.assertEqual(call.call_count,4)
   self.assertFalse((self.c.CACHE/'always-limited.json').exists())
if __name__=='__main__':unittest.main()
