Pod::Spec.new do |s|
  s.name           = 'RoutePicker'
  s.version        = '1.0.0'
  s.summary        = 'AirPlay route picker view'
  s.description    = 'Wraps AVRoutePickerView for the Now Playing output-device button.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
