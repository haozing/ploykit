UPDATE plan SET limits = limits - 'video_renders_monthly'
WHERE limits ? 'video_renders_monthly';
