const { buildCloudMonoAacArgs } = require('./audio-normalize');

describe('audio normalization', () => {
  it('builds a compressed mono AAC command for cloud speaker attribution', () => {
    expect(buildCloudMonoAacArgs('/input/meeting.m4a', '/output/meeting.m4a')).toEqual([
      '-y', '-i', '/input/meeting.m4a', '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', '/output/meeting.m4a',
    ]);
  });
});
