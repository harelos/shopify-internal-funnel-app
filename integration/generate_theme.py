from pathlib import Path
import sys
here=Path(__file__).resolve().parent
app=Path(sys.argv[1])/'app/cloudflare-pilot'
out=here/'theme/snippets';out.mkdir(parents=True,exist_ok=True)
companion=(app/'storefront-source/funnel-control-attribution.js').read_text()
(out/'nh-gallery-bootstrap-runtime.liquid').write_text('{% raw %}\n<script>\n'+companion+'\n'+(here/'storefront/gallery-bootstrap.js').read_text()+'\n</script>\n{% endraw %}\n')
(out/'nh-gallery-bootstrap-style.liquid').write_text('{% raw %}\n<style>\n'+(here/'storefront/gallery-bootstrap.css').read_text()+'\n</style>\n{% endraw %}\n')
