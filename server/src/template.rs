//! Community template rules (increment B): slugs, field limits, and
//! validation against the scene schema.
//!
//! Publishing never renders or prints (the plan's phase-9 promise): the
//! registry checks a template with the same `pn_scene::Template` type
//! and `validate()` the app runs before a job is queued, so anything the
//! registry accepts is something the app can open. One check covers both
//! tracks — `format: scene` for every media kind, `format: html` for
//! page media only.

use pn_scene::{Format, Template};
use serde_json::Value;

/// A slug is 1 to 64 of a-z 0-9 -.
pub const SLUG_MIN_LEN: usize = 1;
pub const SLUG_MAX_LEN: usize = 64;

/// Field limits so one account cannot crowd the gallery with a giant
/// readme or a template the app would have to fetch whole.
pub const NAME_MAX_LEN: usize = 64;
pub const README_MAX_LEN: usize = 16_000;
pub const TEMPLATE_MAX_CHARS: usize = 256_000;
pub const SAMPLE_MAX_CHARS: usize = 64_000;

/// What is wrong with a slug, in plain words (or nothing).
pub fn slug_problem(slug: &str) -> Option<String> {
    let s = slug.trim();
    if s.len() < SLUG_MIN_LEN || s.len() > SLUG_MAX_LEN {
        return Some("the slug must be 1 to 64 characters".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Some("the slug may only use lowercase letters, numbers and -".into());
    }
    None
}

/// What is wrong with a template name, in plain words (or nothing).
pub fn name_problem(name: &str) -> Option<String> {
    let n = name.trim();
    if n.is_empty() || n.len() > NAME_MAX_LEN {
        return Some(format!("the name must be 1 to {NAME_MAX_LEN} characters"));
    }
    None
}

/// What is wrong with a readme, in plain words (or nothing).
pub fn readme_problem(readme: &str) -> Option<String> {
    if readme.len() > README_MAX_LEN {
        return Some(format!(
            "the readme must be at most {README_MAX_LEN} characters"
        ));
    }
    None
}

/// What is wrong with a sample record list, in plain words (or nothing).
/// A sample is a JSON array — one record per object — so a saved local
/// copy can print at once.
pub fn sample_problem(sample: &Value) -> Option<String> {
    if !sample.is_array() {
        return Some("the sample must be a list of records".into());
    }
    let Ok(text) = serde_json::to_string(sample) else {
        return Some("the sample cannot be written back".into());
    };
    if text.len() > SAMPLE_MAX_CHARS {
        return Some(format!(
            "the sample must be at most {SAMPLE_MAX_CHARS} characters"
        ));
    }
    None
}

/// Check a template document (JSON) against the scene schema and return
/// the normalized form the store keeps: the track it renders on
/// (`"scene"` or `"document"`) and the document as text. A parse or
/// validation failure is a plain-words error the API answers 400 with.
pub fn check_template(doc: &Value) -> Result<(String, String), String> {
    let template: Template = serde_json::from_value(doc.clone())
        .map_err(|e| format!("the template does not read as a template: {e}"))?;
    template
        .validate()
        .map_err(|e| format!("the template does not pass the checks: {e}"))?;
    if template.media.width_mm() > 1_000.0 || template.media.height_mm() > 1_000.0 {
        return Err("the template's media is larger than 1000 x 1000 mm".into());
    }
    let track = match template.format {
        Format::Html => "document".to_string(),
        Format::Scene => "scene".to_string(),
    };
    let text = serde_json::to_string(&template)
        .map_err(|e| format!("the template cannot be written back: {e}"))?;
    if text.len() > TEMPLATE_MAX_CHARS {
        return Err(format!(
            "the template must be at most {TEMPLATE_MAX_CHARS} characters"
        ));
    }
    Ok((track, text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn label_template() -> Value {
        json!({
            "media": { "kind": "label", "width_mm": 58.0, "height_mm": 40.0 },
            "fields": [ { "name": "name" } ],
            "elements": [
                {
                    "type": "text",
                    "at": { "x_mm": 2.0, "y_mm": 2.0 },
                    "size": { "w_mm": 50.0, "h_mm": 6.0 },
                    "content": "Hi {{name}}",
                    "style": { "size_mm": 5.0 }
                }
            ]
        })
    }

    #[test]
    fn a_slug_is_1_to_64_lowercase_alnum_dash() {
        assert_eq!(slug_problem("shipping-label"), None);
        assert_eq!(slug_problem("a-1"), None);
        assert_eq!(slug_problem(&"a".repeat(64)), None);
        assert!(slug_problem("").is_some());
        assert!(slug_problem(&"a".repeat(65)).is_some());
        assert!(slug_problem("Upper").is_some(), "uppercase is not a slug");
        assert!(slug_problem("has.space").is_some());
        assert!(slug_problem("under_score").is_some());
    }

    #[test]
    fn a_valid_scene_template_checks_and_derives_its_track() {
        let (track, text) = check_template(&label_template()).expect("it passes");
        assert_eq!(track, "scene");
        // The stored text re-reads to the same, validated template.
        let v: Value = serde_json::from_str(&text).expect("the text is json");
        check_template(&v).expect("the normalized form re-checks");
    }

    #[test]
    fn an_html_template_on_page_media_is_the_document_track() {
        let doc = json!({
            "format": "html",
            "media": { "kind": "page", "width_mm": 210.0, "height_mm": 297.0 },
            "html": "<p>Shipping label</p>",
            "elements": []
        });
        let (track, _) = check_template(&doc).expect("html on page passes");
        assert_eq!(track, "document");
    }

    #[test]
    fn html_on_thermal_media_is_rejected() {
        let doc = json!({
            "format": "html",
            "media": { "kind": "label", "width_mm": 58.0, "height_mm": 40.0 },
            "html": "<p>no</p>",
            "elements": []
        });
        let e = check_template(&doc).expect_err("html cannot print on a label");
        assert!(!e.is_empty());
    }

    #[test]
    fn a_template_with_an_unknown_binding_is_rejected() {
        let doc = label_template();
        // The binding names a field the template does not declare.
        let doc = json!({
            "media": doc["media"],
            "fields": [ { "name": "name" } ],
            "elements": [
                {
                    "type": "text",
                    "at": { "x_mm": 2.0, "y_mm": 2.0 },
                    "size": { "w_mm": 50.0, "h_mm": 6.0 },
                    "content": "Hi {{missing}}",
                    "style": { "size_mm": 5.0 }
                }
            ]
        });
        check_template(&doc).expect_err("the binding is not declared");
    }

    #[test]
    fn a_document_that_is_not_a_template_is_rejected() {
        check_template(&json!({ "nope": true })).expect_err("not a template");
        check_template(&json!([])).expect_err("not an object");
    }

    #[test]
    fn the_name_and_readme_have_limits() {
        assert_eq!(name_problem("Shipping"), None);
        assert!(name_problem("").is_some());
        assert!(name_problem(&"x".repeat(65)).is_some());
        assert_eq!(readme_problem("short"), None);
        assert!(readme_problem(&"x".repeat(16_001)).is_some());
    }

    #[test]
    fn a_sample_must_be_a_list_of_records() {
        assert_eq!(sample_problem(&json!([])), None);
        assert_eq!(sample_problem(&json!([{ "name": "Jane" }])), None);
        assert!(sample_problem(&json!({ "name": "Jane" })).is_some());
        assert!(sample_problem(&json!("[]")).is_some());
    }
}
