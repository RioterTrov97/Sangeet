Pod::Spec.new do |s|
  s.name           = 'StreamProxy'
  s.version        = '1.0.0'
  s.summary        = 'Localhost chunked HTTP range proxy for YouTube audio streams'
  s.description    = 'Serves AVPlayer range requests on 127.0.0.1 by fetching upstream in growing chunks.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
