import React, { useState } from 'react';
import { Download, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { recordingService, type TestConfigLoadResult } from '../../features/recording/services/recordingService';

interface TestConfigSectionProps {
  onLoaded(result: TestConfigLoadResult): Promise<void>;
}

const TestConfigSection: React.FC<TestConfigSectionProps> = ({ onLoaded }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ version: number; revision: string; loadedAt: string } | null>(null);

  if (!window.electron?.invoke) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setNotice('请输入用户名和密码。');
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const result = await recordingService.loadTestConfig(username.trim(), password);
      await onLoaded(result);
      setPassword('');
      setShowPassword(false);
      setLoaded({ version: result.version, revision: result.revision, loadedAt: result.loadedAt });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '加载测试配置失败。');
    } finally {
      setLoading(false);
    }
  };

  return <section className="test-config-section" aria-label="测试配置">
    <div className="test-config-section__heading">
      <div><h2>测试配置</h2><p>登录后自动加载录音转写与豆包同声传译 2.0 配置。</p></div>
      <Download size={19} aria-hidden="true" />
    </div>
    <form className="test-config-section__form" onSubmit={submit}>
      <label>用户名<input autoComplete="username" value={username} disabled={loading} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>密码<span className="test-config-section__password"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} disabled={loading} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
      <button className="test-config-section__submit" type="submit" disabled={loading} aria-label={loading ? '正在加载测试配置' : '加载测试配置'}>{loading ? <LoaderCircle className="recording-spinner" size={16} /> : <Download size={16} />}{loading ? '加载中…' : '加载'}</button>
    </form>
    {notice && <p className="test-config-section__notice is-error" role="alert">{notice}</p>}
    {loaded && <p className="test-config-section__notice is-success" role="status">已加载配置 v{loaded.version} · {loaded.revision} · {new Date(loaded.loadedAt).toLocaleString()}</p>}
  </section>;
};

export default TestConfigSection;
